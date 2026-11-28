"""Background builder of the work plan for one check.

It runs as its own LLM loop next to the chat (same AgentState: shared manual hits and plan), so the
mechanic can ask questions while the plan fills in. Every event is kept and replayed to late
subscribers, so a reconnecting phone gets the whole story.
"""
import asyncio
import base64
import json
import logging
from dataclasses import asdict, dataclass, field

from app.agent import figures
from app.agent.checks import rounding_only
from app.agent.meter import TokenMeter
from app.agent.plan import FINISH_PLAN, UPDATE_PLAN, PlanItem, WorkPlan, update_plan
from app.agent.tools import TOOLS, AgentState, log_check_disputes, run_tool
from app.domain.diagnostic_rules import assess
from app.integrations.llm_client import LLMClient, LLMError
from app.integrations.mock_ml_client import MockMLClient
from app.repositories import store
from app.repositories.vehicle_catalog import JsonVehicleCatalog
from app.schemas.assistant import LANG_RULE, ChatRequest
from app.schemas.diagnostics import DiagnoseRequest
from app.services.agent_service import (
    CONVERSATIONS,
    AgentService,
    Conversation,
    official_links,
    restore_conversation,
    save_conversation,
    summarize,
)

log = logging.getLogger("uvicorn.error")
MAX_ROUNDS = 14
# If the model did not get to them: the stage-3 checklist the customer described, and aftercare without numbers.
FALLBACK = {
    "quality": {
        "ru": ["Все работы по плану выполнены", "Детали и узлы установлены правильно, на свои места",
               "Все соединения и крепления проверены и затянуты", "Не осталось инструмента, ветоши и посторонних предметов",
               "Нет незакреплённых деталей, шлангов и проводов", "Двигатель готов к пуску: уровни масла и жидкости в норме"],
        "uz": ["Rejadagi barcha ishlar bajarildi", "Detallar va uzellar to‘g‘ri, o‘z joyiga o‘rnatildi",
               "Barcha ulanishlar va mahkamlashlar tekshirildi va tortildi", "Asbob, latta va begona narsalar qolmadi",
               "Mahkamlanmagan detal, shlang va simlar yo‘q", "Dvigatel ishga tayyor: moy va suyuqlik darajalari me’yorda"],
        "ko": ["계획한 작업을 모두 마쳤다", "부품과 장치를 제자리에 바르게 달았다", "모든 연결부와 고정부를 확인하고 조였다",
               "공구, 걸레, 이물질이 남아 있지 않다", "고정되지 않은 부품, 호스, 전선이 없다", "엔진 시동 준비 완료: 윤활유와 액체 양이 정상"],
    },
    "aftercare": {
        "ru": ["Первые дни после ремонта слушать двигатель: стук или шум, который вернулся, — признак неудачного ремонта",
               "Проверять, нет ли течей масла и топлива в месте работ", "Следить за давлением масла и температурой по приборам",
               "Повторить акустическую проверку на ближайшем ТО и сравнить с результатом до ремонта"],
        "uz": ["Ta’mirdan keyingi kunlarda dvigatelni tinglang: qaytgan taqillash yoki shovqin — ta’mir muvaffaqiyatsiz bo‘lganini bildiradi",
               "Ish joyida moy va yoqilg‘i oqishi bor-yo‘qligini tekshiring", "Asboblar bo‘yicha moy bosimi va haroratni kuzating",
               "Eng yaqin TXKda akustik tekshiruvni takrorlang va ta’mirdan oldingi natija bilan solishtiring"],
        "ko": ["수리 후 며칠 동안 엔진 소리를 들어 보세요: 두드리는 소리나 소음이 다시 나면 수리가 잘못된 것입니다",
               "작업한 곳에 윤활유나 연료가 새는지 확인하세요", "계기판으로 윤활유 압력과 온도를 지켜보세요",
               "다음 정비 때 음향 점검을 다시 하고 수리 전 결과와 비교하세요"],
    },
}
PLAN_TOOLS = [t for t in TOOLS if t["function"]["name"] in ("search_manual", "view_page", "report_contradiction")] + [
    UPDATE_PLAN, FINISH_PLAN]

PLAN_PROMPT = """Ты готовишь рабочий план для механика, который сейчас будет разбираться с неисправностью. Механик видит план сразу, пока ты работаешь, поэтому заполняй его по частям. План из трёх этапов: 1) Подготовка, 2) Работа, 3) Проверка, и после — рекомендации.

Машина: {vehicle}. Двигатель: {engine}. Доступны только руководства на этот двигатель.
Результат проверки: {diagnosis}

Порядок:
1. Первым же ответом, одновременно: update_plan(section="tools", preliminary=true), update_plan(section="materials", preliminary=true) и update_plan(section="prep", preliminary=true) — что подготовить и как подготовить машину и рабочее место (заглушить двигатель, остудить, подставить упоры и т.п.), по инженерному опыту, коротко, без чисел; и search_manual по процедуре проверки этого узла.
2. Найди в руководстве процедуру проверки/регулировки/ремонта именно этого узла (несколько запросов словами руководства). Оглавление и общий раздел ТО не годятся.
3. disassembly — что снять или разобрать, чтобы добраться до узла (из руководства с ref и quote, если есть; иначе preliminary без чисел).
4. Шаги: update_plan(section="steps", preliminary=false) с ref и дословной quote. Порядок шагов: если руководство задаёт обязательную последовательность (разборка и сборка, регулировка по порядку цилиндров, затяжка в определённом порядке, проверка после регулировки) — сохраняй её как есть. Если шаги не зависят друг от друга (например, разные проверки причины), ставь их от простого к сложному: сначала осмотр и проверки без разборки и без инструмента, потом замеры инструментом, потом то, что требует снятия деталей, разборка и замена — в конце. Если в шаге есть замер с нормой из фрагмента — укажи measure (name, unit, min/max). Шаги добавляй партиями по мере нахождения, не жди конца. Сразу после первой партии шагов — quality и aftercare (п. 6–7), потом уточняй. Если пункт отклонён — исправь один раз или пропусти, не повторяй.
5. Если руководство называет конкретный инструмент, приспособления, запчасти или меры безопасности — добавь их с preliminary=false (ref, quote); если это уточняет предварительный список, замени раздел (replace=true).
6. quality — контрольный список проверки после работ: все работы выполнены, детали и узлы установлены правильно, соединения и крепления проверены (моменты затяжки — только из руководства), не осталось посторонних предметов, двигатель готов к запуску. Пункты из руководства — с ref; общие — preliminary без чисел.
7. aftercare — рекомендации после ремонта: на какие узлы и параметры смотреть, признаки неудачного ремонта или повторной неисправности, что контролировать в первую очередь, через какой пробег перепроверить, профилактика. Пробег, интервалы и нормы — только из руководства (ищи обкатку, ТО, периодичность) с ref; если в руководстве нет — пиши без чисел, preliminary.
8. Чтобы шаг был нагляднее, можешь открыть страницу через view_page и убедиться, что на ней есть рисунок этого узла.
8а. Если фрагменты руководств расходятся (разные нормы или порядок для одного и того же) — report_contradiction с цитатами обеих сторон и severity. Важность: critical — если расхождение меняет то, что делает механик (нормы отличаются больше чем на 5 %, другой порядок работ, одно руководство запрещает или требует то, чего нет в другом); minor — если по сути одно и то же (та же норма в других единицах или округлённая при пересчёте: 5,6…6,2 кгс·м = 54,9…58,8 и 54,9…60,8 Н·м — это не противоречие; разные формулировки). Для critical в этом шаге напиши «есть расхождение в руководствах — см. предупреждение» и в report_contradiction дай recommendation — чего придерживаться и почему (это покажется механику как рекомендация, не из руководства); другие шаги этим не помечай. Для minor шаг пиши как обычно.
9. В конце — finish_plan с короткой запиской. Если процедуры для этого узла в руководстве на этот двигатель нет, шаги не придумывай: finish_plan и объясни это.
Тексты пунктов пиши коротко и простыми словами: механик читает с телефона. {lang_rule} Поле quote — всегда дословно из фрагмента, по-русски."""


@dataclass
class Work:
    conv_id: str
    conv: Conversation
    state: AgentState
    plan: WorkPlan
    log: list[dict] = field(default_factory=list)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    task: asyncio.Task | None = None
    cost_usd: float = 0.0
    lang: str = "ru"
    last_tokens: dict | None = None

    def emit(self, event: dict) -> None:
        if event["type"] == "tokens":  # only the latest counts: kept aside, not in the replayed history
            self.last_tokens = event
        else:
            self.log.append(event)
        for q in self.subscribers:
            q.put_nowait(event)

    def emit_plan(self) -> None:
        self.emit({"type": "plan", "plan": self.plan.snapshot()})
        save_conversation(self.conv_id, self.conv)


# Working copies in memory (one backend worker); every plan update is written through to the store.
WORKS: dict[str, Work] = {}


def get_work(work_id: str) -> Work | None:
    """The live work, or one restored from the store after a restart (its build is over then)."""
    if work_id in WORKS:
        return WORKS[work_id]
    conv = CONVERSATIONS.get(work_id) or restore_conversation(work_id, JsonVehicleCatalog())
    if conv is None or conv.state.plan is None:
        return None
    work = WORKS[work_id] = Work(conv_id=work_id, conv=conv, state=conv.state, plan=conv.state.plan, lang=conv.lang)
    for c in work.plan.conflicts:  # saved before conflicts had a severity
        c.setdefault("severity", "minor" if rounding_only([s["quote"] for s in c["sides"]]) else "critical")
    if work.plan.status == "building":  # the server stopped while it was being built
        work.plan.status, work.plan.note = "failed", "Сборка плана прервалась — соберите заново."
        work.emit_plan()
    work.log = [{"type": "plan", "plan": work.plan.snapshot()}, {"type": "done", "cost_usd": 0}]
    return work


async def rebuild(work_id: str) -> None:
    """Builds the plan of a work again from scratch (after a failure); ticks of the old plan are dropped."""
    work = get_work(work_id)
    if work is None:
        raise LookupError(f"Нет работы {work_id}")
    if work.task and not work.task.done():
        return
    work.plan = work.state.plan = WorkPlan()
    work.log, work.cost_usd, work.last_tokens = [], 0.0, None
    store.update_work_data(work_id, progress={})
    work.emit_plan()
    work.task = asyncio.create_task(_build(work))


def book_check(d, verdict: dict, vehicle_id: str, work_id: str) -> None:
    """Put the check into the service book once; after a repair it is a re-check."""
    kind = "recheck" if store.entries(vehicle_id, "repair") else "diagnosis"
    if store.has_entry(vehicle_id, kind, d.session_id):
        return
    title = (f"{d.anomaly_type} {d.anomaly_title}" if d.status == "anomaly"
             else "Норма" if d.status == "normal" else "Сбой записи")
    store.add_entry(vehicle_id, kind, title, d.description, {**d.model_dump(), **verdict},
                    work_id=work_id, session_id=d.session_id)


async def start(vehicle_id: str, session_id: str, lang: str = "ru") -> str:
    """Creates (or reuses) the conversation for this check and starts building its plan.
    An unfinished work for the same check and language is reused: opening the check again costs nothing."""
    for saved in store.list_works(vehicle_id, "active"):
        work = get_work(saved["id"]) if saved["session_id"] == session_id and saved["lang"] == lang else None
        if work and work.plan.status != "failed":
            return work.conv_id
    service = AgentService()
    conv_id, conv = service._conversation(ChatRequest(vehicle_id=vehicle_id, session_id=session_id, message=".",
                                                      lang=lang))
    if conv_id in WORKS:
        return conv_id
    plan = WorkPlan()
    conv.state.plan = plan
    work = WORKS[conv_id] = Work(conv_id=conv_id, conv=conv, state=conv.state, plan=plan, lang=lang)
    save_conversation(conv_id, conv, status="active")
    work.task = asyncio.create_task(_build(work))
    return conv_id


async def illustrate(work: Work, items: list[PlanItem], meter: TokenMeter | None = None) -> None:
    """The model picks a drawing for each new step (or none); the plan updates when it is done."""
    picks, usage = await figures.pick([(str(i.id), i.text + (f" — «{i.quote}»" if i.quote else ""), i.manual_id, i.pdf_page)
                                       for i in items if i.manual_id and i.pdf_page], meter, work.emit)
    work.cost_usd += usage.get("cost") or 0.0
    for i in items:
        if pick := picks.get(str(i.id)):
            i.figure, i.figure_page = pick.figure, pick.pdf_page
    log.info("plan %s figures: %s of %s steps", work.conv_id[:8], sum(1 for p in picks.values() if p), len(items))
    work.emit_plan()


async def _build(work: Work) -> None:
    state, plan = work.state, work.plan
    meter = TokenMeter(work.emit)  # ↑↓ tokens of the whole build, live
    try:
        d = await MockMLClient().diagnose(DiagnoseRequest(vehicle_id=state.vehicle.vehicle_id, session_id=state.session_id))
        state.diagnosis = d
        verdict = assess(d, state.vehicle.fuel)
        book_check(d, verdict, state.vehicle.vehicle_id, work.conv_id)
        log_check_disputes(d, verdict, work.conv_id)
        if d.status != "anomaly" or verdict["ticket_blocked_reason"] and not verdict["needs_warning_confirmation"]:
            plan.note_code = verdict["block_code"] or ""
            plan.status, plan.note = "ready", (
                "Отклонений нет — план работ не нужен." if d.status == "normal"
                else verdict["ticket_blocked_reason"] or "Нужна повторная запись."
            )
            work.emit_plan()
            return
        v = state.vehicle
        messages = [{"role": "system", "content": PLAN_PROMPT.format(
            vehicle=" ".join(x for x in (v.make, v.model, v.vehicle_id) if x), engine=v.engine_model,
            diagnosis=json.dumps({**d.model_dump(), **verdict}, ensure_ascii=False, default=str),
            lang_rule=LANG_RULE.get(work.lang, LANG_RULE["ru"]),
        )}, {"role": "user", "content": "Составь рабочий план."}]
        work.emit_plan()
        llm = LLMClient()
        drawing: list[asyncio.Task] = []  # pictures are picked for steps while the plan keeps growing
        nudges = 2
        for _ in range(MAX_ROUNDS):
            work.emit({"type": "thinking"})
            message, usage = await meter.call(llm, messages, PLAN_TOOLS)
            work.cost_usd += usage.get("cost") or 0.0
            messages.append(message)
            calls = message.get("tool_calls") or []
            if not calls:
                log.info("plan %s: model stopped without finish_plan: %s", work.conv_id[:8],
                         (message.get("content") or "")[:300])
                if not nudges:
                    break
                nudges -= 1  # it sometimes stops mid-way with an empty message: ask it to go on
                messages.append({"role": "user", "content": (
                    f"Ты остановился, не вызвав finish_plan. В плане шагов: {len(plan.steps)}, "
                    f"проверка: {len(plan.quality)}, рекомендации: {len(plan.aftercare)}. Продолжай по порядку: "
                    "шаги из найденных фрагментов (update_plan, section=steps), затем quality и aftercare, "
                    "в конце finish_plan. Если процедуры для этого узла в руководстве нет — сразу finish_plan с объяснением.")})
                continue
            images = []
            for call in calls:
                name, raw = call["function"]["name"], call["function"].get("arguments") or "{}"
                try:
                    args = json.loads(raw)
                except json.JSONDecodeError:
                    args = {}
                if name == "update_plan":
                    before = {i.id for i in plan.steps}
                    result = update_plan(plan, state.hits, **{k: args.get(k) for k in
                                                              ("section", "preliminary", "items")},
                                         replace=bool(args.get("replace")))
                    log.info("plan %s %s: +%s, rejected %s", work.conv_id[:8], args.get("section"),
                             result.get("accepted"), result.get("rejected"))
                    if added := [i for i in plan.steps if i.id not in before]:
                        drawing.append(asyncio.create_task(illustrate(work, added, meter)))
                    work.emit_plan()
                elif name == "finish_plan":
                    plan.note, plan.status = str(args.get("note", "")), "ready"
                    result = {"ok": True}
                else:
                    work.emit({"type": "tool", "name": name, "args": args})
                    result = await run_tool(state, name, raw)
                    if image := result.pop("_image", None):
                        images.append((result["ref"], image))
                    work.emit({"type": "tool_result", "name": name, **summarize(name, result)})
                    if name == "report_contradiction" and result.get("ok"):
                        plan.conflicts = [c | {"official": official_links(c)} for c in state.contradictions]
                        work.emit_plan()
                messages.append({"role": "tool", "tool_call_id": call["id"],
                                 "content": json.dumps(result, ensure_ascii=False, default=str)})
            for ref, png in images:
                messages.append({"role": "user", "content": [
                    {"type": "text", "text": f"Изображение страницы {ref}:"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
                ]})
            if plan.status == "ready":
                break
        for result in await asyncio.gather(*drawing, return_exceptions=True):
            if isinstance(result, Exception):
                log.warning("plan %s: picking figures failed: %s", work.conv_id[:8], result)
        for section, texts in FALLBACK.items():
            if not getattr(plan, section) and plan.steps:
                update_plan(plan, state.hits, section, True, [{"text": t} for t in texts[work.lang]])
        if plan.status != "ready":
            plan.status = "ready"
            plan.note = plan.note or ("План собран по найденным страницам руководства." if plan.steps
                                      else "Процедура для этого узла в руководстве не найдена.")
    except (LLMError, OSError, LookupError) as exc:
        log.warning("plan build failed: %s", exc)
        plan.status, plan.note = "failed", f"Не удалось собрать план: {exc}"
    except Exception:
        log.exception("plan build crashed")
        plan.status, plan.note = "failed", "Не удалось собрать план."
    finally:
        work.emit_plan()
        work.emit({"type": "done", "cost_usd": round(work.cost_usd, 6), "tokens": meter.totals()})


def in_norm(measure: dict | None, value: str) -> bool | None:
    try:
        v = float(str(value).replace(",", "."))
    except ValueError:
        return None
    if not measure:
        return None
    return (measure.get("min") is None or v >= measure["min"]) and (measure.get("max") is None or v <= measure["max"])


def finish(work_id: str) -> list[int]:
    """Closes a repair: what was checked and measured, what was done, and aftercare go into the book."""
    work = get_work(work_id)
    if work is None:
        raise LookupError(f"Нет работы {work_id}")
    saved = store.load_work(work_id)
    progress = (saved or {}).get("data", {}).get("progress") or {}
    states, checks = progress.get("steps") or {}, progress.get("checks") or {}
    plan, vid, d = work.plan, work.state.vehicle.vehicle_id, work.state.diagnosis
    fault = f"{d.anomaly_type} {d.anomaly_title}" if d and d.anomaly_type else "неисправность"
    rows = []
    for i, s in enumerate(plan.steps, 1):
        st = states.get(str(s.id)) or {}
        measure = asdict(s.measure) if s.measure else None
        skipped = bool(measure) and not (st.get("value") or "").strip() and bool(st.get("skipped") or st.get("done"))
        rows.append({"n": i, "text": s.text, "done": bool(st.get("done")) and not skipped, "skipped": skipped,
                     "value": st.get("value") or None,
                     "measure": measure, "ok": in_norm(measure, st.get("value") or "") if st.get("value") else None,
                     "manual": s.manual, "pdf_page": s.pdf_page})
    ids = []
    measured = [r for r in rows if r["value"]]
    bad = [r for r in measured if r["ok"] is False]
    skipped = [r for r in rows if r["skipped"]]
    ids.append(store.add_entry(vid, "defect", f"Дефектовка: {fault}",
                               f"Замеров: {len(measured)}, вне нормы: {len(bad)}"
                               + (f", пропущено: {len(skipped)}" if skipped else ""), {"steps": rows},
                               work_id=work_id, session_id=work.state.session_id))
    if skipped:  # the mechanic went on without a measurement: allowed, but the chief mechanic should see it
        store.add_dispute("measure_skipped", "Пропущены замеры: " + "; ".join(
            f"шаг {r['n']} — {(r['measure'] or {}).get('name') or r['text'][:60]}" for r in skipped),
            vid, work_id, {"steps": skipped})
    done = [r["text"] for r in rows if r["done"]]
    if done:
        ids.append(store.add_entry(vid, "repair", "Выполненные работы", "\n".join(done),
                                   {"steps": [r for r in rows if r["done"]],
                                    "quality": [{"text": q.text, "ok": bool(checks.get(str(q.id)))} for q in plan.quality]},
                                   work_id=work_id, session_id=work.state.session_id))
    if plan.aftercare:
        ids.append(store.add_entry(vid, "recommendation", "Рекомендации после ремонта",
                                   "\n".join(a.text for a in plan.aftercare),
                                   {"items": [asdict(a) for a in plan.aftercare]},
                                   work_id=work_id, session_id=work.state.session_id))
    store.set_work_status(work_id, "done")
    return ids
