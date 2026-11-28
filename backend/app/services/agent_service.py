"""Agent loop: the LLM picks tools until it can answer; then the answer is checked against sources."""
import base64
import json
import logging
import re
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field

from app.agent import figures
from app.agent.meter import TokenMeter
from app.agent.checks import answer_problems, render_citations
from app.agent.plan import WorkPlan
from app.agent.tools import TOOLS, AgentState, run_tool
from app.domain.diagnostic_rules import CONFIDENCE_MIN, URGENCY_MEANING
from app.integrations.llm_client import LLMClient
from app.rag import pages
from app.rag.manuals import BY_ID
from app.rag.search import Hit
from app.repositories import store
from app.repositories.vehicle_catalog import JsonVehicleCatalog
from app.schemas.assistant import (
    LANG_RULE,
    UNVERIFIED,
    ChatRequest,
    ChatResponse,
    SourceReference,
    Step,
)
from app.schemas.diagnostics import DiagnoseResponse
from app.schemas.vehicles import Vehicle

MAX_TOOL_ROUNDS = 6
log = logging.getLogger("uvicorn.error")

SYSTEM_PROMPT = """Ты — «Цифровой механик», помощник механика автопарка. Решение о состоянии двигателя принимает механик, ты помогаешь.

Машина: {vehicle}
Двигатель: {engine}. Тебе доступны только руководства на этот двигатель.
Текущая проверка: {session_id}.
История проверок (от ранней к поздней):
{history}
Ранее созданные заявки: {tickets}

Инструменты: get_diagnosis — результат акустической проверки; search_manual — поиск по руководствам; view_page — посмотреть страницу руководства с рисунками; create_ticket — заявка на дефектовку в ТОиР; check_photo — что на фото механика; report_contradiction — расхождение в руководствах.

Правила:
1. Числа (нормативы, допуски, моменты затяжки, давления, зазоры) и порядок работ — только из фрагментов search_manual. Сразу после утверждения ставь ключ фрагмента в квадратных скобках, например [yamz236_rk:41]. Ключи бери только из результатов поиска. Фрагмент с ocr=true распознан со скана: числа из него сопровождай пометкой «сверить по странице руководства».
2. Не нашёл в руководстве — так и скажи: «В руководстве на {engine} это не найдено», и рекомендуй дефектовку. Данные других двигателей и общие знания нормативами не выдавай.
3. Причины и риски можно описывать как инженерные гипотезы: только в разделе «Гипотезы (инженерная оценка, не из руководства)», без чисел и без ссылок.
4. Ищи несколькими запросами словами руководства, пока не найдёшь процедуру именно этого узла. Оглавление и общий раздел ТО доказательством не являются.
5. Результат проверки (когда объясняешь его):
   - status=check_failed или signal_quality=bad: никаких выводов о двигателе, попроси повторить запись (проверить установку стенда, шум вокруг).
   - status=normal: значимых отклонений нет, эксплуатация продолжается.
   - status=anomaly: что за неисправность, насколько уверена модель, приоритет (поле urgency) и что проверить по руководству.
   - confidence < {conf_min:.2f}: результат ненадёжен, нужна повторная проверка, заявка не создаётся. Назови порог механику.
   - signal_quality=warning: всегда предупреди, что запись с помехами и уверенность снижена; заявка только после того, как механик нажмёт кнопку «Подтверждаю, создать заявку» (словами в чате подтвердить нельзя).
6. «Запрещено выпускать в рейс / эксплуатация запрещена» пиши только если фрагмент руководства прямо это говорит, со ссылкой. Иначе формулируй как рекомендацию. Приоритеты: high — {u_high}; medium — {u_medium}; low — {u_low}.
7. create_ticket вызывай только по команде механика. Нужна процедура именно того узла, на который указывает тип неисправности; процедура по смежному симптому (например, «двигатель работает неустойчиво» вместо системы зажигания) не годится. Если такой процедуры нет — заявку не создавай: объясни, что в руководстве на этот двигатель нет инструкции по этой неисправности, и дай текст рекомендации на дефектовку с результатом проверки. Если в диагнозе есть ticket_blocked_reason или create_ticket вернул error — объясни причину простыми словами. Если руководство прямо запрещает эксплуатацию при этой неисправности — передай цитату в operation_ban.
8. Объём ответа.
   - Полный разбор — только когда механик просит объяснить результат проверки («Объясни результат проверки …») или просит подробно. Пиши для механика, не для программиста: никаких названий полей и служебных значений (status, anomaly, score, confidence, signal_quality, ticket_blocked_reason, urgency, good/warning, high/medium/low) — только простые слова («отклонение», «уверенность 71 %», «приоритет высокий»). Подробные цифры проверки (оценка отклонения, порог, качество записи, версия модели) механик видит сам в «Подробностях проверки» — не пересказывай их.
     Первая строка — вердикт: что, скорее всего, неисправно и что делать с машиной (по приоритету). Дальше ровно эти разделы, каждый коротко:
     Наблюдения — 2–3 пункта: что слышно (описание проверки своими словами); уверенность одной фразой («уверенность 71 % — достаточно для вывода»; порог называй, только если уверенность ниже него); прошлые проверки одной фразой (впервые / повторяется / стало хуже). Помехи в записи — только если они есть, «помех нет» не пиши. Отдельных разделов для уверенности, записи и истории не делай.
     Гипотезы (инженерная оценка, не из руководства) — 1–2 пункта.
     Проверки — не перечисляй и для них не ищи в руководстве: шаги проверки по руководству механику составляет план диагностики во вкладке «Работа», второй список с другими шагами только запутает. Если по результату нужна проверка (отклонение, заявка не заблокирована), напиши одной строкой: «по плану во вкладке «Работа» — шаги проверки по руководству со страницами».
     Возможный ремонт — 1–2 пункта: что, скорее всего, понадобится, если проверки подтвердят неисправность (замена, регулировка…), рекомендацией, без шагов и без чисел; ремонт делают по заявке на дефектовку.
     Искать в руководстве при объяснении можно только одно: прямо ли оно запрещает эксплуатацию при такой неисправности (тогда процитируй со ссылкой в вердикте).
     Источник — одна строка (результат проверки и страницы, если ссылался). Ограничения — одна строка.
     Весь ответ должен читаться с телефона за минуту.
   - Шаги в ответах — только проверки (как осмотреть, измерить, проверить). Порядок шагов: если руководство задаёт обязательную последовательность (проверка по порядку работы цилиндров, снятие перед осмотром) — сохраняй её как есть. Если шаги не зависят друг от друга (например, разные проверки причины), ставь их от простого к сложному: сначала осмотр и проверки без разборки и без инструмента, потом замеры инструментом, проверки со снятием деталей — в конце.
   - Ремонт (замену, регулировку, восстановление) по шагам не расписывай: механик делает диагностику, ремонт — по заявке на дефектовку. Если спрашивают про ремонт — скажи, что рекомендуется, со ссылкой на страницы руководства, где описана процедура, и что это пойдёт в заявку.
   - Любой другой вопрос — уточняющий: ответь прямо на него в 1–3 коротких предложениях, первой фразой — ответ («Да» / «Нет» / что сделать). Если в ответе норма или запрет — короткая цитата со ссылкой. Если просят «как проверить» — короткий нумерованный список шагов, каждый со ссылкой. Не повторяй результат проверки, уверенность, порог, приоритет, этап и то, что уже сказано выше; без разделов и заголовков. Гипотезу, если она нужна, — отдельной строкой «Гипотеза (не из руководства): …».
   Пиши просто, без JSON и без внутренних полей.
9. Фото от механика: сначала check_photo — что на фото и похоже ли на двигатель этой машины ({engine}); если не похоже, скажи это первой строкой. Затем найди в руководстве рисунок этого узла (search_manual, затем view_page) и сравни. Вывод по фото — всегда гипотеза в разделе «Гипотезы»: скажи, что именно совпадает или не совпадает, на какой рисунок и страницу опирался, и что проверить руками. Размеры и нормы по фото не определяй.
10. Если фрагменты руководств расходятся (разные нормы, порядок, допуски для одного и того же) — вызови report_contradiction с цитатами обеих сторон и severity. Важность: critical — если расхождение меняет то, что делает механик (нормы отличаются больше чем на 5 %, другой порядок работ, одно руководство запрещает или требует то, чего нет в другом); minor — если по сути одно и то же (та же норма в других единицах или округлённая при пересчёте: 5,6…6,2 кгс·м = 54,9…58,8 и 54,9…60,8 Н·м — это не противоречие; разные формулировки). Для critical в ответе покажи оба варианта со ссылками, затем отдельной строкой «Рекомендация (не из руководства): …» — чего придерживаться и почему (более конкретный документ, более новая редакция, более безопасный вариант; новых чисел не придумывай), и посоветуй уточнить у производителя. Для minor в ответе не выделяй, дай норму по одному фрагменту.
11. Если в сообщении указано, где механик в инструкции (этап, шаг) — это подсказка: если вопрос про «этот шаг», отвечай про него; сам этап в ответе не называй.
11а. Ниже может быть «План диагностики» — шаги проверки, которые механик видит во вкладке «Работа». На вопросы «что делать / что проверить / как» опирайся на них и называй их номера («шаг 3»); другой порядок или другой список шагов не составляй. Если нужного в плане нет — ищи в руководстве и скажи, что это дополнение к плану.
12. Язык ответа указан в конце сообщения механика. На вопросы не о технике и не об этой машине вежливо откажись."""

ANSWER_NOW = "Поиск окончен. Ответь механику сейчас по уже найденным фрагментам, без новых вызовов инструментов."

FIX_PROMPT = (
    "Проверка ответа не пройдена: {problems}. Перепиши ответ: каждое число — только из "
    "процитированного фрагмента со ссылкой [ключ], ключи — только из результатов поиска; "
    "если подтверждения нет, убери число и скажи, что в руководстве это не найдено."
)


Emit = Callable[[dict], None]


def summarize(name: str, result: dict) -> dict:
    """What the UI shows about a finished tool call (no manual text, just what happened)."""
    if "error" in result:
        return {"error": result["error"]}
    if name == "search_manual":
        return {"found": [{"manual_id": f["ref"].partition(":")[0], "manual": f.get("manual"), "pdf_page": f.get("pdf_page")}
                          for f in result.get("found", [])]}
    if name == "view_page":
        manual_id, _, page = (result.get("ref") or "").partition(":")
        m = BY_ID.get(manual_id)
        return {"ref": result.get("ref"), "found": [{"manual_id": manual_id, "manual": m.short if m else manual_id,
                                                     "pdf_page": int(page)}] if m and page.isdigit() else []}
    if name == "get_diagnosis":
        return {k: result.get(k) for k in ("session_id", "status", "anomaly_type", "anomaly_title", "confidence")}
    if name == "create_ticket":
        return {"ticket_id": result.get("ticket_id"), "urgency": result.get("urgency")}
    return {}


RENDERED_CITE = re.compile(r"\(([^()]+?), стр\. (\d+)\)")
LIST_ITEM = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.*)$")


def step_key(text: str) -> str:
    """Key of a list item of an answer; the UI computes the same one (Markdown.tsx stepKey)."""
    plain = RENDERED_CITE.sub("", text).replace("**", "").replace("📖", "").lower()
    return re.sub(r"[\W_]+", "", plain)[:60]


async def step_figures(answer: str, cited: list[Hit], steps: list[Step], emit: Emit,
                       meter: TokenMeter | None = None) -> dict[str, dict]:
    """For list items that cite a page: the drawing the model picked for each ({step_key: figure}), none if none fits."""
    by_ref = {(h.short, h.pdf_page): h for h in cited}
    items = []
    for line in answer.splitlines():
        item = LIST_ITEM.match(line)
        cite = item and RENDERED_CITE.search(item.group(1))
        hit = cite and by_ref.get((cite.group(1), int(cite.group(2))))
        if hit:
            text = RENDERED_CITE.sub("", item.group(1)).replace("**", "").strip()
            items.append((step_key(item.group(1)), text, hit.manual_id, hit.pdf_page))
    if not items:
        return {}
    emit({"type": "figures"})
    t0 = time.perf_counter()
    picks, usage = await figures.pick(items, meter, emit)
    if usage.get("prompt_tokens"):
        steps.append(Step(name="llm:figures", prompt_tokens=usage["prompt_tokens"],
                          completion_tokens=usage["completion_tokens"], cost_usd=usage["cost"],
                          seconds=round(time.perf_counter() - t0, 2)))
    manual = {h.manual_id: h.short for h in cited}
    return {key: {"manual_id": manual_id, "manual": manual[manual_id], "pdf_page": pick.pdf_page, "figure": pick.figure}
            for key, _, manual_id, _ in items if (pick := picks.get(key))}


def official_links(contradiction: dict) -> list[dict]:
    """Where to ask the manufacturer: official pages of the manuals on both sides."""
    seen, out = set(), []
    for side in contradiction["sides"]:
        m = BY_ID.get(side["manual_id"])
        if m and m.official_url and m.id not in seen:
            seen.add(m.id)
            out.append({"manual": m.short, "url": m.official_url})
    return out


def figure_count(manual_id: str, page: int) -> int:
    try:
        return len(pages.figures(manual_id, page))
    except (LookupError, OSError):
        return 0


@dataclass
class Conversation:
    state: AgentState
    messages: list[dict] = field(default_factory=list)
    lang: str = "ru"
    transcript: list[dict] = field(default_factory=list)  # what the mechanic saw: text, sources, ticket


# Working copies live in memory (one backend worker) and are written through to the store, so a
# repair can be resumed after a restart or from another device.
CONVERSATIONS: dict[str, Conversation] = {}


def save_conversation(conv_id: str, conv: Conversation, status: str | None = None, **extra) -> None:
    """Write the working copy through to the store (plan and progress are kept if already saved)."""
    st = conv.state
    saved = store.load_work(conv_id)
    data = (saved or {}).get("data", {}) | {
        "messages": conv.messages,
        "hits": [asdict(h) for h in st.hits.values()],
        "diagnosis": st.diagnosis.model_dump() if st.diagnosis else None,
        "plan": st.plan.snapshot() if st.plan else (saved or {}).get("data", {}).get("plan"),
        "chat": conv.transcript,
    } | extra
    status = status or (saved["status"] if saved else ("active" if st.plan else "chat"))
    store.save_work(conv_id, st.vehicle.vehicle_id, st.session_id, conv.lang, status, data)


def restore_conversation(conv_id: str, catalog: JsonVehicleCatalog) -> Conversation | None:
    saved = store.load_work(conv_id)
    vehicle = catalog.get_vehicle(saved["vehicle_id"]) if saved else None
    if vehicle is None:
        return None
    data = saved["data"]
    state = AgentState(
        vehicle=vehicle, session_id=saved["session_id"], conversation_id=conv_id,
        diagnosis=DiagnoseResponse.model_validate(data["diagnosis"]) if data.get("diagnosis") else None,
        hits={f"{h['manual_id']}:{h['pdf_page']}": Hit(**h) for h in data.get("hits", [])},
        plan=WorkPlan.from_snapshot(data["plan"]) if data.get("plan") else None,
    )
    conv = Conversation(state=state, messages=data.get("messages") or [], lang=saved["lang"] or "ru",
                        transcript=data.get("chat") or [])
    if not conv.messages:
        conv.messages.append({"role": "system", "content": system_prompt(vehicle, state.session_id)})
    CONVERSATIONS[conv_id] = conv
    return conv


def plan_brief(plan: WorkPlan | None) -> str:
    """The steps the mechanic sees on the Работа screen, so chat answers keep to them."""
    if plan is None or not plan.steps:
        return ""
    lines = [f"{i}. {s.text[:140]}" + (f" (стр. {s.pdf_page})" if s.pdf_page else "") for i, s in enumerate(plan.steps[:25], 1)]
    status = " (план ещё собирается)" if plan.status == "building" else ""
    return f"\n\nПлан диагностики во вкладке «Работа»{status}:\n" + "\n".join(lines)


def system_prompt(vehicle: Vehicle, session_id: str, plan: WorkPlan | None = None) -> str:
    history = "\n".join(
        f"- {s.session_id} {s.checked_at:%d.%m.%Y}: {s.status}"
        + (f", {s.anomaly_type} {s.anomaly_title}, score {s.anomaly_score}" if s.anomaly_type else "")
        + f", качество {s.signal_quality}"
        for s in vehicle.sessions
    )
    tickets = [
        f"{t['ticket_id']} ({t['session_id']}, {t['anomaly_type']}, {t['urgency']})"
        for t in store.tickets(vehicle.vehicle_id)
    ]
    name = " ".join(x for x in (vehicle.make, vehicle.model, vehicle.vehicle_id, vehicle.garage_no) if x)
    return SYSTEM_PROMPT.format(
        vehicle=name,
        engine=vehicle.engine_model,
        session_id=session_id,
        history=history,
        tickets=", ".join(tickets) or "нет",
        conf_min=CONFIDENCE_MIN,
        u_high=URGENCY_MEANING["high"],
        u_medium=URGENCY_MEANING["medium"],
        u_low=URGENCY_MEANING["low"],
    ) + plan_brief(plan)


class AgentService:
    def __init__(self, catalog: JsonVehicleCatalog | None = None, llm: LLMClient | None = None) -> None:
        self.catalog = catalog or JsonVehicleCatalog()
        self.llm = llm or LLMClient()
        self.meter = TokenMeter(lambda event: None)

    def _conversation(self, payload: ChatRequest) -> tuple[str, Conversation]:
        conv = CONVERSATIONS.get(payload.conversation_id or "")
        if conv is None and payload.conversation_id:
            conv = restore_conversation(payload.conversation_id, self.catalog)
        if conv and conv.state.vehicle.vehicle_id == payload.vehicle_id:
            return payload.conversation_id, conv
        vehicle = self.catalog.get_vehicle(payload.vehicle_id)
        if vehicle is None:
            raise LookupError(f"Транспортное средство {payload.vehicle_id} не найдено.")
        if not vehicle.sessions:
            raise LookupError(f"У {payload.vehicle_id} нет проверок.")
        session_id = payload.session_id or vehicle.sessions[-1].session_id
        conv_id = uuid.uuid4().hex
        conv = Conversation(AgentState(vehicle=vehicle, session_id=session_id, conversation_id=conv_id),
                            lang=payload.lang)
        conv.messages.append({"role": "system", "content": system_prompt(vehicle, session_id)})
        CONVERSATIONS[conv_id] = conv
        return conv_id, conv

    async def _llm(
        self, conv: Conversation, steps: list[Step], tool_choice: str = "auto", purpose: str | None = None
    ) -> dict:
        """One LLM call. The step is named by what the model did: llm:<tools it called>, llm:answer, llm:fix."""
        t0 = time.perf_counter()
        message, usage = await self.meter.call(self.llm, conv.messages, TOOLS, tool_choice)
        seconds = time.perf_counter() - t0
        called = sorted({c["function"]["name"] for c in message.get("tool_calls", [])})
        name = purpose or ("llm:" + "+".join(called) if called else "llm:answer")
        log.info("%s %.1fs in=%s cached=%s out=%s reasoning=%s", name, seconds, usage.get("prompt_tokens"),
                 (usage.get("prompt_tokens_details") or {}).get("cached_tokens"), usage.get("completion_tokens"),
                 (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"))
        conv.messages.append(message)
        steps.append(Step(
            name=name,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            cost_usd=usage.get("cost") or 0.0,
            seconds=round(seconds, 2),
        ))
        return message

    async def chat(self, payload: ChatRequest, emit: Emit | None = None) -> ChatResponse:
        """emit(event) reports progress as it happens: thinking, tool, tool_result, checking, fixing."""
        emit = emit or (lambda event: None)
        self.meter = TokenMeter(emit)  # ↑↓ tokens of this answer, live
        conv_id, conv = self._conversation(payload)
        state = conv.state
        if payload.session_id and payload.session_id != state.session_id:
            state.session_id, state.diagnosis = payload.session_id, None
        state.warning_confirmed = payload.confirm_warning
        state.contradictions, state.photo_check = [], None
        if conv.messages and conv.messages[0].get("role") == "system":  # current rules, session and tickets
            conv.messages[0] = {"role": "system", "content": system_prompt(state.vehicle, state.session_id, state.plan)}
        text = payload.message
        if payload.confirm_warning:
            text += "\n[Механик прочитал предупреждение о качестве записи и подтверждает создание заявки.]"
        if state.plan and (state.plan.steps or state.plan.tools):
            plan_steps = "; ".join(f"{i + 1}) {st.text[:80]}" for i, st in enumerate(state.plan.steps[:12]))
            text += (f"\n[План диагностики ({'готов' if state.plan.status == 'ready' else 'собирается в фоне'}), "
                     f"механик его видит. Шаги: {plan_steps or 'пока нет'}]")
        if payload.context:
            c = payload.context
            stage = {"prep": "подготовка", "work": "шаги проверки", "check": "проверка после диагностики",
                     "after": "после диагностики"}.get(c.stage or "", "")
            text += f"\n[Механик сейчас в инструкции: этап «{stage}»" + (f", шаг {c.step_index}: {c.step_text}" if c.step_index else "") + "]"
        text += f"\n[{LANG_RULE[payload.lang]}]"
        if payload.images:
            text += f"\n[Механик приложил фото: {len(payload.images)} шт.]"
            content = [{"type": "text", "text": text}] + [
                {"type": "image_url", "image_url": {"url": url}} for url in payload.images
            ]
            conv.messages.append({"role": "user", "content": content})
        else:
            conv.messages.append({"role": "user", "content": text})

        steps: list[Step] = []
        diagnosis_before, tickets_before = state.diagnosis, len(store.tickets(state.vehicle.vehicle_id))
        emit({"type": "thinking"})
        message = await self._llm(conv, steps)
        for _ in range(MAX_TOOL_ROUNDS):
            if not message.get("tool_calls"):
                break
            images = []
            for call in message["tool_calls"]:
                fn = call["function"]
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                emit({"type": "tool", "name": fn["name"], "args": {k: v for k, v in args.items() if k != "references"}})
                result = await run_tool(state, fn["name"], fn.get("arguments", ""))
                if image := result.pop("_image", None):
                    images.append((result["ref"], image))
                emit({"type": "tool_result", "name": fn["name"], **summarize(fn["name"], result)})
                steps.append(Step(name=fn["name"]))
                conv.messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": json.dumps(result, ensure_ascii=False, default=str),
                })
            for ref, png in images:  # tool messages are text-only, so pages go in as a user message
                conv.messages.append({"role": "user", "content": [
                    {"type": "text", "text": f"Изображение страницы {ref} (по запросу view_page):"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
                ]})
            emit({"type": "thinking"})
            message = await self._llm(conv, steps)
        if message.get("tool_calls"):  # out of rounds: its last tool calls stay unanswered, so drop them and ask
            conv.messages.pop()
            conv.messages.append({"role": "user", "content": ANSWER_NOW})
            message = await self._llm(conv, steps, tool_choice="none")
        if not (message.get("content") or "").strip():  # an empty answer happens now and then: ask once more
            conv.messages.append({"role": "user", "content": ANSWER_NOW})
            message = await self._llm(conv, steps, tool_choice="none")

        answer = message.get("content") or ""
        tickets = store.tickets(state.vehicle.vehicle_id)
        trusted = json.dumps(
            {
                "vehicle": state.vehicle.model_dump(mode="json"),
                "dates": [f"{s.checked_at:%d.%m.%Y %d.%m %H:%M}" for s in state.vehicle.sessions],
                "percents": [round(x * 100) for s in state.vehicle.sessions
                             for x in (s.anomaly_score, s.confidence) if x is not None],
                "diagnosis": state.diagnosis.model_dump() if state.diagnosis else None,
                "tickets": tickets,
                "threshold": [CONFIDENCE_MIN, f"{CONFIDENCE_MIN:.2f}", 50],
            },
            ensure_ascii=False,
            default=str,
        )
        emit({"type": "checking"})
        problems = answer_problems(answer, state.hits, trusted)
        if problems:
            emit({"type": "fixing", "problems": problems})
            conv.messages.append({"role": "user", "content": FIX_PROMPT.format(problems="; ".join(problems))})
            answer = (await self._llm(conv, steps, "none", purpose="llm:fix")).get("content") or answer
            problems = answer_problems(answer, state.hits, trusted)
            if problems:
                detail = ": " + "; ".join(problems) if payload.lang == "ru" else ""  # details are Russian
                answer += f"\n\n{UNVERIFIED[payload.lang]}{detail}."
                store.add_dispute("unverified_numbers", "; ".join(problems), state.vehicle.vehicle_id, conv_id,
                                  {"question": payload.message, "answer": answer[:2000]})

        answer, cited = render_citations(answer, state.hits)
        pictures = await step_figures(answer, cited, steps, emit, self.meter)
        new_ticket = tickets[-1] if len(tickets) > tickets_before else None
        conv.lang = payload.lang
        response = ChatResponse(
            conversation_id=conv_id,
            answer=answer,
            sources=[
                SourceReference(manual_id=h.manual_id, manual=h.short, pdf_page=h.pdf_page, excerpt=h.text,
                                ocr=h.ocr, figures=figure_count(h.manual_id, h.pdf_page))
                for h in cited
            ],
            diagnosis=state.diagnosis if state.diagnosis is not diagnosis_before else None,
            ticket=new_ticket,
            photo_check=state.photo_check,
            contradictions=[c | {"official": official_links(c)} for c in state.contradictions],
            figures=pictures,
            steps=steps,
            cost_usd=round(sum(s.cost_usd for s in steps), 6),
        )
        conv.transcript += [
            {"role": "user", "text": payload.message, "images": len(payload.images)},
            {"role": "assistant", "text": answer, "sources": [x.model_dump() for x in response.sources],
             "ticket": new_ticket, "cost": response.cost_usd, "figures": pictures,
             "contradictions": response.contradictions},
        ]
        save_conversation(conv_id, conv)
        return response
