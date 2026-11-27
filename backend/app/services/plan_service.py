"""Background builder of the work plan for one check.

It runs as its own LLM loop next to the chat (same AgentState: shared manual hits and plan), so the
mechanic can ask questions while the plan fills in. Every event is kept and replayed to late
subscribers, so a reconnecting phone gets the whole story.
"""
import asyncio
import base64
import json
import logging
from dataclasses import dataclass, field

from app.agent.plan import FINISH_PLAN, UPDATE_PLAN, WorkPlan, update_plan
from app.agent.tools import TOOLS, AgentState, run_tool
from app.domain.diagnostic_rules import assess
from app.integrations.llm_client import LLMClient, LLMError
from app.integrations.mock_ml_client import MockMLClient
from app.schemas.assistant import LANG_RULE, ChatRequest
from app.schemas.diagnostics import DiagnoseRequest
from app.services.agent_service import AgentService, summarize

log = logging.getLogger("uvicorn.error")
MAX_ROUNDS = 10
PLAN_TOOLS = [t for t in TOOLS if t["function"]["name"] in ("search_manual", "view_page")] + [UPDATE_PLAN, FINISH_PLAN]

PLAN_PROMPT = """Ты готовишь рабочий план для механика, который сейчас будет разбираться с неисправностью. Механик видит план сразу, пока ты работаешь, поэтому заполняй его по частям.

Машина: {vehicle}. Двигатель: {engine}. Доступны только руководства на этот двигатель.
Результат проверки: {diagnosis}

Порядок:
1. Первым же ответом, одновременно: update_plan(section="tools", preliminary=true) и update_plan(section="materials", preliminary=true) — что механику подготовить для проверки этого узла, по инженерному опыту, коротко, без чисел; и search_manual по процедуре проверки этого узла.
2. Найди в руководстве процедуру проверки/регулировки/ремонта именно этого узла (несколько запросов словами руководства). Оглавление и общий раздел ТО не годятся.
3. Добавляй шаги по порядку: update_plan(section="steps", preliminary=false) с ref и дословной quote. Если в шаге есть замер с нормой из фрагмента — укажи measure (name, unit, min/max). Шаги добавляй партиями по мере нахождения, не жди конца.
4. Если руководство называет конкретный инструмент, приспособления или запчасти — добавь их с preliminary=false (ref, quote); если это уточняет предварительный список, замени раздел (replace=true).
5. Меры безопасности из руководства — section="safety".
6. Чтобы шаг был нагляднее, можешь открыть страницу через view_page и убедиться, что на ней есть рисунок этого узла.
7. В конце — finish_plan с короткой запиской. Если процедуры для этого узла в руководстве на этот двигатель нет, шаги не придумывай: finish_plan и объясни это.
Тексты пунктов пиши коротко и простыми словами: механик читает с телефона. {lang_rule} Поле quote — всегда дословно из фрагмента, по-русски."""


@dataclass
class Work:
    state: AgentState
    plan: WorkPlan
    log: list[dict] = field(default_factory=list)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    task: asyncio.Task | None = None
    cost_usd: float = 0.0
    lang: str = "ru"

    def emit(self, event: dict) -> None:
        self.log.append(event)
        for q in self.subscribers:
            q.put_nowait(event)

    def emit_plan(self) -> None:
        self.emit({"type": "plan", "plan": self.plan.snapshot()})


# shortcut: in-memory like conversations; one backend worker.
WORKS: dict[str, Work] = {}


async def start(vehicle_id: str, session_id: str, lang: str = "ru") -> str:
    """Creates (or reuses) the conversation for this check and starts building its plan."""
    service = AgentService()
    conv_id, conv = service._conversation(ChatRequest(vehicle_id=vehicle_id, session_id=session_id, message="."))
    if conv_id in WORKS:
        return conv_id
    plan = WorkPlan()
    conv.state.plan = plan
    work = WORKS[conv_id] = Work(state=conv.state, plan=plan, lang=lang)
    work.task = asyncio.create_task(_build(work))
    return conv_id


async def _build(work: Work) -> None:
    state, plan = work.state, work.plan
    try:
        d = await MockMLClient().diagnose(DiagnoseRequest(vehicle_id=state.vehicle.vehicle_id, session_id=state.session_id))
        state.diagnosis = d
        verdict = assess(d, state.vehicle.fuel)
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
        for _ in range(MAX_ROUNDS):
            work.emit({"type": "thinking"})
            message, usage = await llm.chat(messages, PLAN_TOOLS)
            work.cost_usd += usage.get("cost") or 0.0
            messages.append(message)
            calls = message.get("tool_calls") or []
            if not calls:
                break
            images = []
            for call in calls:
                name, raw = call["function"]["name"], call["function"].get("arguments") or "{}"
                try:
                    args = json.loads(raw)
                except json.JSONDecodeError:
                    args = {}
                if name == "update_plan":
                    result = update_plan(plan, state.hits, **{k: args.get(k) for k in
                                                              ("section", "preliminary", "items")},
                                         replace=bool(args.get("replace")))
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
                messages.append({"role": "tool", "tool_call_id": call["id"],
                                 "content": json.dumps(result, ensure_ascii=False, default=str)})
            for ref, png in images:
                messages.append({"role": "user", "content": [
                    {"type": "text", "text": f"Изображение страницы {ref}:"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
                ]})
            if plan.status == "ready":
                break
        if plan.status != "ready":
            plan.status = "ready"
            plan.note = plan.note or "План собран по найденным страницам руководства."
    except (LLMError, OSError, LookupError) as exc:
        log.warning("plan build failed: %s", exc)
        plan.status, plan.note = "failed", f"Не удалось собрать план: {exc}"
    except Exception:
        log.exception("plan build crashed")
        plan.status, plan.note = "failed", "Не удалось собрать план."
    finally:
        work.emit_plan()
        work.emit({"type": "done", "cost_usd": round(work.cost_usd, 6)})
