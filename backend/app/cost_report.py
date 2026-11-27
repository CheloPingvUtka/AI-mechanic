"""Cost calculator: runs real scenarios through the agent and writes a Markdown report.

Run from backend/ with both mocks up and the index built:
    python -m app.cost_report --out ../docs/cost.md [--usd-rub 95]
It spends real LLM money: about $0.1 per run (4 anomaly dialogues + 2 short ones). Costs are what OpenRouter bills (usage.cost).

Scenario (customer's definition): from the diagnosis result to the answer or the ticket.
"""
import argparse
import asyncio
import statistics
import time
from collections import defaultdict
from datetime import date
from pathlib import Path

import httpx

from app.core.config import settings
from app.domain.diagnostic_rules import CONFIDENCE_MIN, fault_mismatch
from app.integrations import speech
from app.rag.indexer import build
from app.repositories.vehicle_catalog import JsonVehicleCatalog
from app.schemas.assistant import ChatRequest, Step
from app.services import plan_service
from app.services.agent_service import AgentService

QUESTIONS = ["Чем опасна эта неисправность?", "Можно ли своим ходом перегнать машину на базу?"]
# Voice mode assumption: phrases read aloud (verdict, steps, answers) and recognised per check.
VOICE_PHRASES_PER_CHECK = 5
VOICE_SAMPLES = {
    "ru": "Отклонение: дизельная топливоподача. Уверенность 73 процента. Приоритет средний.",
    "uz": "Og‘ish: dizel yoqilg‘isi berish tizimi. Ishonchlilik 73 foiz. Ustuvorlik o‘rtacha.",
}
# Fleet assumptions from the customer's example (Q&A 26.11.2026).
FLEET, DAYS_BETWEEN_CHECKS, QUESTIONS_PER_CHECK = 50, 14, 2.5
DAYS_PER_MONTH = 365 / 12

PLAN_TITLE = "Фоновый рабочий план (подготовка, шаги, рисунки)"
CATEGORIES = [
    ("Выбор инструмента и поиск по руководству", lambda n: n.startswith("llm:") and n not in
     ("llm:answer", "llm:fix") and "create_ticket" not in n),
    ("Формирование заявки (вызов create_ticket)", lambda n: n.startswith("llm:") and "create_ticket" in n),
    ("Генерация ответа механику", lambda n: n == "llm:answer"),
    ("Повтор после проверки чисел и ссылок", lambda n: n == "llm:fix"),
]


def category(name: str) -> str | None:
    return next((title for title, match in CATEGORIES if match(name)), None)


def pick_vehicles():
    """One clean anomaly per engine manual, plus one normal and one failed check (latest sessions)."""
    vehicles = JsonVehicleCatalog().list_vehicles()
    anomaly, seen = [], set()
    for v in vehicles:
        manual_group = "ЗМЗ-409" if v.engine_model.startswith("ЗМЗ-409") else v.engine_model
        for s in v.sessions:
            ok = (s.status == "anomaly" and s.signal_quality == "good" and (s.confidence or 0) >= CONFIDENCE_MIN
                  and not fault_mismatch(s.anomaly_type, v.fuel))
            if ok and manual_group not in seen:
                seen.add(manual_group)
                anomaly.append((v, s))
                break
    first = {st: next((v, s) for v in vehicles for s in v.sessions if s.status == st)
             for st in ("normal", "check_failed")}
    return anomaly, first["normal"], first["check_failed"]


async def run_turns(service: AgentService, vehicle_id: str, session_id: str, messages: list[str]):
    """Returns [(turn label, steps, seconds)] for one conversation."""
    conv, out = None, []
    for label, text in messages:
        t0 = time.perf_counter()
        reply = await service.chat(ChatRequest(
            vehicle_id=vehicle_id, session_id=session_id, message=text, conversation_id=conv,
        ))
        conv = reply.conversation_id
        out.append((label, reply.steps, time.perf_counter() - t0))
    return out


def model_price() -> tuple[float, float] | None:
    """USD per 1M input/output tokens from OpenRouter's public model list, if reachable."""
    try:
        models = httpx.get(f"{settings.llm_base_url}/models", timeout=15).json()["data"]
        p = next(m["pricing"] for m in models if m["id"] == settings.llm_model)
        return float(p["prompt"]) * 1e6, float(p["completion"]) * 1e6
    except (httpx.HTTPError, KeyError, StopIteration, ValueError):  # informational only
        return None


def usd(x: float) -> str:
    return f"${x:.4f}" if x < 1 else f"${x:,.2f}"


async def measure():
    anomaly, normal, failed = pick_vehicles()
    service = AgentService()
    jobs = [run_turns(service, v.vehicle_id, s.session_id,
                      [("explain", f"Объясни результат проверки {s.session_id}")]
                      + [("question", q) for q in QUESTIONS]
                      + [("ticket", "Создай заявку на дефектовку")]) for v, s in anomaly]
    jobs += [run_turns(service, v.vehicle_id, s.session_id, [(kind, f"Объясни результат проверки {s.session_id}")])
             for kind, (v, s) in (("explain_normal", normal), ("explain_failed", failed))]
    plan_ids = [await plan_service.start(v.vehicle_id, s.session_id) for v, s in anomaly]
    runs = await asyncio.gather(*jobs)
    await asyncio.gather(*(plan_service.WORKS[i].task for i in plan_ids))
    plan_costs = [plan_service.WORKS[i].cost_usd for i in plan_ids]
    return anomaly, normal, failed, runs, plan_costs, await measure_voice()


async def measure_voice() -> dict:
    """One verified spoken verdict per language, then recognition of that audio."""
    out = {}
    for lang, text in VOICE_SAMPLES.items():
        speech._cache(text, lang).unlink(missing_ok=True)  # measure a real synthesis, not the cache
        t0 = time.perf_counter()
        try:
            wav, tts_cost = await speech.speak(text, lang)
        except speech.SpeechError as exc:
            out[lang] = {"error": str(exc)}
            continue
        tts_seconds = time.perf_counter() - t0
        _, stt_cost = await speech.transcribe(wav, lang)
        out[lang] = {"tts": tts_cost, "tts_seconds": tts_seconds, "stt": stt_cost, "chars": len(text)}
    return out


def report(anomaly, normal, failed, runs, plan_costs, voice, index_seconds: float, usd_rub: float | None) -> str:
    turns = defaultdict(list)  # kind -> [(cost, prompt, completion, llm calls, seconds)]
    per_category = defaultdict(float)  # summed over measured anomaly scenarios
    for run in runs:
        for kind, steps, seconds in run:
            llm: list[Step] = [s for s in steps if s.name.startswith("llm:")]
            turns[kind].append((sum(s.cost_usd for s in llm), sum(s.prompt_tokens for s in llm),
                                sum(s.completion_tokens for s in llm), len(llm), seconds))
            if kind in ("explain", "question", "ticket"):
                for s in llm:
                    per_category[category(s.name)] += s.cost_usd
    avg = {k: [statistics.mean(col) for col in zip(*v)] for k, v in turns.items()}
    n_anomaly = len(anomaly)
    plan_avg = statistics.mean(plan_costs) if plan_costs else 0.0
    per_category[PLAN_TITLE] = plan_avg * n_anomaly

    def cost(kind):
        return avg[kind][0]

    scenario = {
        "anomaly": cost("explain") + QUESTIONS_PER_CHECK * cost("question") + cost("ticket") + plan_avg,
        "normal": cost("explain_normal") + QUESTIONS_PER_CHECK * cost("question"),
        "check_failed": cost("explain_failed"),
    }
    sessions = [s for v in JsonVehicleCatalog().list_vehicles() for s in v.sessions]
    share = {st: sum(s.status == st for s in sessions) / len(sessions) for st in scenario}
    per_check = sum(share[st] * scenario[st] for st in scenario)
    checks_month = FLEET * DAYS_PER_MONTH / DAYS_BETWEEN_CHECKS
    measured_total = sum(per_category.values()) / n_anomaly
    run_totals = [sum(st.cost_usd for _, steps, _ in run for st in steps) for run in runs[:n_anomaly]]
    price = model_price()
    rub = (lambda x: f" ≈ {x * usd_rub:,.2f} ₽".replace(",", " ")) if usd_rub else (lambda x: "")

    lines = [
        "# Калькулятор стоимости агента «Цифровой механик»",
        "",
        f"Замер {date.today():%d.%m.%Y}, модель `{settings.llm_model}` через OpenRouter. "
        "Стоимость — фактически списанная OpenRouter (`usage.cost`) за реальные прогоны агента, а не оценка по тарифу."
        + (f" Справочно: цена в каталоге OpenRouter на дату замера ${price[0]:.3f} за 1 млн входных и "
           f"${price[1]:.3f} за 1 млн выходных токенов; запросы обслуживают разные провайдеры по своим ценам, "
           "кэшированный вход дешевле — поэтому расчёт ведётся по списанной сумме." if price else ""),
        "",
        ("Сценарий — от получения результата диагностики до ответа механику или заявки. В него входят все "
        "вызовы модели: выбор инструмента, поиск, генерация ответа, формирование заявки и повторы."),
        "",
        "## Что измерено",
        "",
        f"- {n_anomaly} машины с отклонением, по одной на каждое руководство: "
        + ", ".join(f"{v.vehicle_id} ({v.engine_model}, {s.session_id}, {s.anomaly_type})" for v, s in anomaly)
        + ". Диалог: «Объясни результат проверки» → 2 вопроса механика → «Создай заявку».",
        (f"- Проверка с нормой: {normal[0].vehicle_id} {normal[1].session_id}; сбой записи: "
        f"{failed[0].vehicle_id} {failed[1].session_id} — по одному сообщению «Объясни результат»."),
        "",
        "## Один сценарий с отклонением: разбивка по шагам",
        "",
        (f"Среднее на сценарий из {n_anomaly} прогонов (объяснение + 2 вопроса + заявка + рабочий план в фоне). "
         "В пересчёте на парк ниже — 2,5 вопроса, поэтому сумма там немного больше."),
        "",
        "| Шаг | Стоимость | Доля |",
        "|---|---:|---:|",
    ]
    for title in [t for t, _ in CATEGORIES] + [PLAN_TITLE]:
        c = per_category[title] / n_anomaly
        lines.append(f"| {title} | {usd(c)} | {c / measured_total:.0%} |")
    lines += [
        "| Эмбеддинги запросов | $0 | — |",
        "| Поиск по индексу, Mock ML, Mock ТОиР | $0 | — |",
        f"| **Итого на сценарий** | **{usd(measured_total)}**{rub(measured_total)} | 100% |",
        "",
        ("Эмбеддингов нет: поиск по руководствам — BM25 по локальному индексу, без вызовов внешних моделей. "
        "Сами инструменты (поиск, Mock ML, Mock ТОиР) работают локально и денег не стоят."),
        "",
        "## Стоимость по сообщениям механика",
        "",
        "| Сообщение | Стоимость | Токены вход / выход | Вызовов модели | Время ответа |",
        "|---|---:|---:|---:|---:|",
    ]
    labels = {"explain": "Объяснить результат (отклонение)", "question": "Вопрос механика",
              "ticket": "Создать заявку", "explain_normal": "Объяснить результат (норма)",
              "explain_failed": "Объяснить результат (сбой записи)"}
    for kind, label in labels.items():
        c, p, o, calls, sec = avg[kind]
        lines.append(f"| {label} | {usd(c)} | {p:,.0f} / {o:,.0f} | {calls:.1f} | {sec:.0f} с |".replace(",", " "))
    lines += [
        "",
        "## Пересчёт на автопарк",
        "",
        "Допущения:",
        "",
        (f"- парк {FLEET} машин, каждая проверяется раз в {DAYS_BETWEEN_CHECKS} дней: "
        f"{checks_month:.1f} проверки в месяц;"),
        (f"- на каждую проверку с нормой или отклонением — {QUESTIONS_PER_CHECK:g} вопроса механика "
        "(середина диапазона «2–3» из примера заказчика); при сбое записи вопросов нет, механик перезаписывает;"),
        ("- на каждую проверку с отклонением механик просит создать заявку (даже если агент откажет — "
        "запрос всё равно стоит денег);"),
        "- доля исходов — как в синтетической истории заказчика (`vehicles.json`): "
        + ", ".join(f"{label} {share[st]:.0%}" for st, label in
                    (("normal", "норма"), ("anomaly", "отклонение"), ("check_failed", "сбой записи")))
        + ";",
        "- цена модели не меняется, кэш промптов работает как в замере.",
        "",
        "| Исход проверки | Доля | Стоимость сценария |",
        "|---|---:|---:|",
    ]
    for st, label in (("anomaly", "Отклонение"), ("normal", "Норма"), ("check_failed", "Сбой записи")):
        lines.append(f"| {label} | {share[st]:.0%} | {usd(scenario[st])}{rub(scenario[st])} |")
    lines += [
        f"| **Средняя проверка** | | **{usd(per_check)}**{rub(per_check)} |",
        "",
        "| Период | Проверок | Стоимость LLM |",
        "|---|---:|---:|",
        f"| Месяц | {checks_month:.0f} | {usd(per_check * checks_month)}{rub(per_check * checks_month)} |",
        f"| Год | {checks_month * 12:.0f} | {usd(per_check * checks_month * 12)}{rub(per_check * checks_month * 12)} |",
        "",
        "## Голосовой режим (по желанию механика)",
        "",
        ("Озвучка — только короткие фразы (вердикт, текущий шаг, первый абзац ответа), каждая проверяется "
         "распознаванием её же звука. Замер одной фразы-вердикта:"),
        "",
        "| Язык | Озвучка | Распознавание | Время озвучки |",
        "|---|---:|---:|---:|",
        *[(f"| {lang} | {usd(v['tts'])} | {usd(v['stt'])} | {v['tts_seconds']:.0f} с |" if "tts" in v
           else f"| {lang} | не удалось: {v['error']} | — | — |") for lang, v in voice.items()],
        "",
        *voice_lines(voice, checks_month),
        "",
        "## Разовая индексация руководств",
        "",
        (f"6 PDF (1743 страницы): извлечение текста, нарезка, OCR страниц-сканов через tesseract — "
        f"локально, без LLM и эмбеддингов. **$0**, около {index_seconds:.0f} с на одном ПК "
        "(замер в этом прогоне). Повторяется только при добавлении руководств."),
        "",
        "## Ограничения замера",
        "",
        (f"- Мало прогонов ({n_anomaly} сценария с отклонением). Стоимость зависит от того, сколько поисков "
         f"выберет модель: в этом замере диалог (без фонового плана) стоил от {usd(min(run_totals))} до {usd(max(run_totals))}."),
        "- В цену не входят хостинг backend и реальный ML-сервис «НейроДВС».",
        "- Пересчитать: `python -m app.cost_report --out ../docs/cost.md` (backend, запущенные заглушки, "
        "построенный индекс)." + (f" Курс: {usd_rub} ₽ за $1 — допущение." if usd_rub else ""),
        "",
    ]
    return "\n".join(lines)


def voice_lines(voice: dict, checks_month: float) -> list[str]:
    ok = [v for v in voice.values() if "tts" in v]
    if not ok:
        return []
    per_phrase = statistics.mean(v["tts"] + v["stt"] for v in ok)
    per_check = per_phrase * VOICE_PHRASES_PER_CHECK
    return [(f"Допущение: в голосовом режиме {VOICE_PHRASES_PER_CHECK} озвученных и распознанных фраз на проверку "
            f"(≈ {usd(per_phrase)} за фразу) — это {usd(per_check)} на проверку и {usd(per_check * checks_month)} "
            "в месяц на парк, если голосом пользуются на каждой проверке. Повтор одной и той же фразы бесплатен "
            "(кэш).")]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="../docs/cost.md")
    ap.add_argument("--usd-rub", type=float, help="курс для пересчёта в рубли (допущение)")
    args = ap.parse_args()
    t0 = time.perf_counter()
    build(Path(settings.knowledge_base_path).expanduser())
    index_seconds = time.perf_counter() - t0
    anomaly, normal, failed, runs, plan_costs, voice = asyncio.run(measure())
    text = report(anomaly, normal, failed, runs, plan_costs, voice, index_seconds, args.usd_rub)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
