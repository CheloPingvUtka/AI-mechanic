"""Agent loop: the LLM picks tools until it can answer; then the answer is checked against sources."""
import json
import logging
import time
import uuid
from dataclasses import dataclass, field

from app.agent.checks import answer_problems, render_citations
from app.agent.tools import TICKETS_BY_VEHICLE, TOOLS, AgentState, run_tool
from app.domain.diagnostic_rules import CONFIDENCE_MIN, URGENCY_MEANING
from app.integrations.llm_client import LLMClient
from app.repositories.vehicle_catalog import JsonVehicleCatalog
from app.schemas.assistant import ChatRequest, ChatResponse, SourceReference, Step
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

Инструменты: get_diagnosis — результат акустической проверки; search_manual — поиск по руководствам; create_ticket — заявка на дефектовку в ТОиР.

Правила:
1. Числа (нормативы, допуски, моменты затяжки, давления, зазоры) и порядок работ — только из фрагментов search_manual. Сразу после утверждения ставь ключ фрагмента в квадратных скобках, например [yamz236_rk:41]. Ключи бери только из результатов поиска. Фрагмент с ocr=true распознан со скана: числа из него сопровождай пометкой «сверить по странице руководства».
2. Не нашёл в руководстве — так и скажи: «В руководстве на {engine} это не найдено», и рекомендуй дефектовку. Данные других двигателей и общие знания нормативами не выдавай.
3. Причины и риски можно описывать как инженерные гипотезы: только в разделе «Гипотезы (инженерная оценка, не из руководства)», без чисел и без ссылок.
4. Ищи несколькими запросами словами руководства, пока не найдёшь процедуру именно этого узла. Оглавление и общий раздел ТО доказательством не являются.
5. Результат проверки:
   - status=check_failed или signal_quality=bad: никаких выводов о двигателе, попроси повторить запись (проверить установку стенда, шум вокруг).
   - status=normal: значимых отклонений нет, эксплуатация продолжается.
   - status=anomaly: тип, уверенность, приоритет (поле urgency) и что проверить по руководству.
   - confidence < {conf_min:.2f}: результат ненадёжен, нужна повторная проверка, заявка не создаётся. Назови порог механику.
   - signal_quality=warning: всегда предупреди, что запись с помехами и уверенность снижена; заявка только после того, как механик нажмёт кнопку «Подтверждаю, создать заявку» (словами в чате подтвердить нельзя).
6. «Запрещено выпускать в рейс / эксплуатация запрещена» пиши только если фрагмент руководства прямо это говорит, со ссылкой. Иначе формулируй как рекомендацию. Приоритеты: high — {u_high}; medium — {u_medium}; low — {u_low}.
7. create_ticket вызывай только по команде механика. Нужна процедура именно того узла, на который указывает тип неисправности; процедура по смежному симптому (например, «двигатель работает неустойчиво» вместо системы зажигания) не годится. Если такой процедуры нет — заявку не создавай: объясни, что в руководстве на этот двигатель нет инструкции по этой неисправности, и дай текст рекомендации на дефектовку с результатом проверки. Если в диагнозе есть ticket_blocked_reason или create_ticket вернул error — объясни причину простыми словами. Если руководство прямо запрещает эксплуатацию при этой неисправности — передай цитату в operation_ban.
8. Ответ по отклонению или технический ответ: первой строкой — короткий вердикт. Дальше разделы: Наблюдения; Гипотезы (инженерная оценка, не из руководства); Проверки; Возможный ремонт; Источник; Ограничения. Пиши коротко и просто, без JSON и без внутренних полей.
9. Отвечай по-русски. На вопросы не о технике и не об этой машине вежливо откажись."""

FIX_PROMPT = (
    "Проверка ответа не пройдена: {problems}. Перепиши ответ: каждое число — только из "
    "процитированного фрагмента со ссылкой [ключ], ключи — только из результатов поиска; "
    "если подтверждения нет, убери число и скажи, что в руководстве это не найдено."
)


@dataclass
class Conversation:
    state: AgentState
    messages: list[dict] = field(default_factory=list)


# shortcut: conversations live in process memory; one backend worker only. Move to Redis/DB for scale.
CONVERSATIONS: dict[str, Conversation] = {}


def system_prompt(vehicle: Vehicle, session_id: str) -> str:
    history = "\n".join(
        f"- {s.session_id} {s.checked_at:%d.%m.%Y}: {s.status}"
        + (f", {s.anomaly_type} {s.anomaly_title}, score {s.anomaly_score}" if s.anomaly_type else "")
        + f", качество {s.signal_quality}"
        for s in vehicle.sessions
    )
    tickets = [
        f"{t['ticket_id']} ({t['session_id']}, {t['anomaly_type']}, {t['urgency']})"
        for t in TICKETS_BY_VEHICLE.get(vehicle.vehicle_id, [])
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
    )


class AgentService:
    def __init__(self, catalog: JsonVehicleCatalog | None = None, llm: LLMClient | None = None) -> None:
        self.catalog = catalog or JsonVehicleCatalog()
        self.llm = llm or LLMClient()

    def _conversation(self, payload: ChatRequest) -> tuple[str, Conversation]:
        conv = CONVERSATIONS.get(payload.conversation_id or "")
        if conv and conv.state.vehicle.vehicle_id == payload.vehicle_id:
            return payload.conversation_id, conv
        vehicle = self.catalog.get_vehicle(payload.vehicle_id)
        if vehicle is None:
            raise LookupError(f"Транспортное средство {payload.vehicle_id} не найдено.")
        if not vehicle.sessions:
            raise LookupError(f"У {payload.vehicle_id} нет проверок.")
        session_id = payload.session_id or vehicle.sessions[-1].session_id
        conv = Conversation(AgentState(vehicle=vehicle, session_id=session_id))
        conv.messages.append({"role": "system", "content": system_prompt(vehicle, session_id)})
        conv_id = uuid.uuid4().hex
        CONVERSATIONS[conv_id] = conv
        return conv_id, conv

    async def _llm(
        self, conv: Conversation, steps: list[Step], tool_choice: str = "auto", purpose: str | None = None
    ) -> dict:
        """One LLM call. The step is named by what the model did: llm:<tools it called>, llm:answer, llm:fix."""
        t0 = time.perf_counter()
        message, usage = await self.llm.chat(conv.messages, TOOLS, tool_choice)
        seconds = time.perf_counter() - t0
        called = sorted({c["function"]["name"] for c in message.get("tool_calls", [])})
        name = purpose or ("llm:" + "+".join(called) if called else "llm:answer")
        log.info("%s %.1fs in=%s out=%s", name, seconds, usage.get("prompt_tokens"), usage.get("completion_tokens"))
        conv.messages.append(message)
        steps.append(Step(
            name=name,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            cost_usd=usage.get("cost") or 0.0,
            seconds=round(seconds, 2),
        ))
        return message

    async def chat(self, payload: ChatRequest) -> ChatResponse:
        conv_id, conv = self._conversation(payload)
        state = conv.state
        if payload.session_id and payload.session_id != state.session_id:
            state.session_id, state.diagnosis = payload.session_id, None
        state.warning_confirmed = payload.confirm_warning
        text = payload.message
        if payload.confirm_warning:
            text += "\n[Механик прочитал предупреждение о качестве записи и подтверждает создание заявки.]"
        conv.messages.append({"role": "user", "content": text})

        steps: list[Step] = []
        diagnosis_before, tickets_before = state.diagnosis, len(TICKETS_BY_VEHICLE[state.vehicle.vehicle_id])
        message = await self._llm(conv, steps)
        for _ in range(MAX_TOOL_ROUNDS):
            if not message.get("tool_calls"):
                break
            for call in message["tool_calls"]:
                fn = call["function"]
                result = await run_tool(state, fn["name"], fn.get("arguments", ""))
                steps.append(Step(name=fn["name"]))
                conv.messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": json.dumps(result, ensure_ascii=False, default=str),
                })
            message = await self._llm(conv, steps)
        if message.get("tool_calls"):  # out of rounds: force a plain answer
            message = await self._llm(conv, steps, tool_choice="none")

        answer = message.get("content") or ""
        tickets = TICKETS_BY_VEHICLE[state.vehicle.vehicle_id]
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
        problems = answer_problems(answer, state.hits, trusted)
        if problems:
            conv.messages.append({"role": "user", "content": FIX_PROMPT.format(problems="; ".join(problems))})
            answer = (await self._llm(conv, steps, "none", purpose="llm:fix")).get("content") or answer
            problems = answer_problems(answer, state.hits, trusted)
            if problems:
                answer += "\n\n⚠ Не подтверждено руководством: " + "; ".join(problems) + "."

        answer, cited = render_citations(answer, state.hits)
        new_ticket = tickets[-1] if len(tickets) > tickets_before else None
        return ChatResponse(
            conversation_id=conv_id,
            answer=answer,
            sources=[
                SourceReference(manual=h.short, pdf_page=h.pdf_page, excerpt=h.text, ocr=h.ocr)
                for h in cited
            ],
            diagnosis=state.diagnosis if state.diagnosis is not diagnosis_before else None,
            ticket=new_ticket,
            steps=steps,
            cost_usd=round(sum(s.cost_usd for s in steps), 6),
        )
