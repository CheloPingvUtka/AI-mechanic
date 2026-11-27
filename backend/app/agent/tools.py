"""Agent tools: diagnosis, manual search, defect ticket. The LLM decides which to call;
the product rules (domain/diagnostic_rules.py) and source checks are enforced here, not in the prompt."""
import json
from collections import defaultdict
from dataclasses import dataclass, field

import httpx
from pydantic import ValidationError

from app.agent.checks import numbers, quote_in
from app.domain.diagnostic_rules import (
    OPERATION_BAN,
    URGENCY_MEANING,
    assess,
    ticket_block_reason,
    urgency,
)
from app.integrations.mock_ml_client import MockMLClient
from app.integrations.mock_toir_client import MockToirClient
from app.rag.search import Hit, get_index
from app.schemas.diagnostics import DiagnoseRequest, DiagnoseResponse
from app.schemas.tickets import Reference, TicketCreate
from app.schemas.vehicles import Vehicle

# shortcut: tickets live in process memory and vanish on restart; move to a DB when history matters.
TICKETS_BY_VEHICLE: dict[str, list[dict]] = defaultdict(list)


@dataclass
class AgentState:
    vehicle: Vehicle
    session_id: str
    diagnosis: DiagnoseResponse | None = None
    hits: dict[str, Hit] = field(default_factory=dict)
    warning_confirmed: bool = False  # set by the mechanic's explicit confirmation in the UI


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_diagnosis",
            "description": "Получить результат акустической проверки двигателя этой машины из ML-сервиса.",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "Проверка (S-0001…). Не указывай, чтобы взять текущую проверку.",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_manual",
            "description": (
                "Поиск по заводским руководствам на двигатель ЭТОЙ машины. Возвращает фрагменты с ключом "
                "ref (руководство:страница PDF). Формулируй запрос словами руководства, например "
                "«давление масла ниже допустимого», «момент затяжки болтов крышек коренных подшипников», "
                "«порядок регулировки зазоров клапанов». Делай несколько запросов, если первый не дал ответа."
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_ticket",
            "description": (
                "Создать заявку на дефектовку в ТОиР. Только по команде механика и только если найдена "
                "процедура проверки/регулировки/ремонта именно этого узла в руководстве на этот двигатель. "
                "Код неисправности, проверка и приоритет подставляются автоматически."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "conclusion": {"type": "string", "description": "Диагноз одной-двумя фразами."},
                    "operations": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Работы по руководству; числа только из процитированных фрагментов.",
                    },
                    "spare_parts": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Запчасти, названные в руководстве; может быть пустым.",
                    },
                    "references": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "ref": {"type": "string", "description": "Ключ фрагмента из search_manual."},
                                "quote": {"type": "string", "description": "Дословная цитата из этого фрагмента."},
                            },
                            "required": ["ref", "quote"],
                        },
                    },
                    "operation_ban": {
                        "type": "object",
                        "description": (
                            "Только если фрагмент руководства прямо запрещает эксплуатацию при этой "
                            "неисправности: ключ и дословная цитата запрета. Поднимает приоритет до high."
                        ),
                        "properties": {"ref": {"type": "string"}, "quote": {"type": "string"}},
                        "required": ["ref", "quote"],
                    },
                },
                "required": ["conclusion", "operations", "spare_parts", "references"],
            },
        },
    },
]


async def get_diagnosis(state: AgentState, session_id: str | None = None) -> dict:
    sid = session_id or state.session_id
    if sid not in {s.session_id for s in state.vehicle.sessions}:
        return {"error": f"Проверки {sid} у машины {state.vehicle.vehicle_id} нет."}
    d = await MockMLClient().diagnose(DiagnoseRequest(vehicle_id=state.vehicle.vehicle_id, session_id=sid))
    state.diagnosis, state.session_id = d, sid
    return {**d.model_dump(), **assess(d, state.vehicle.fuel, state.warning_confirmed)}


async def search_manual(state: AgentState, query: str) -> dict:
    hits = get_index().search(state.vehicle.engine_model, query)
    for h in hits:  # a page may come back as different fragments; keep everything the model has seen
        seen = state.hits.get(h.ref)
        if seen is None:
            state.hits[h.ref] = Hit(h.manual_id, h.manual, h.pdf_page, h.score, h.text, h.ocr)
        elif h.text not in seen.text:
            seen.text += "\n…\n" + h.text
    if not hits:
        return {"found": [], "note": f"В руководствах на {state.vehicle.engine_model} ничего не найдено."}
    return {
        "found": [
            {"ref": h.ref, "manual": h.short, "pdf_page": h.pdf_page, "ocr": h.ocr, "text": h.text}
            for h in hits
        ]
    }


async def create_ticket(
    state: AgentState,
    conclusion: str,
    operations: list[str],
    spare_parts: list[str],
    references: list[dict],
    operation_ban: dict | None = None,
) -> dict:
    d = state.diagnosis
    if d is None:
        return {"error": "Сначала получите результат диагностики (get_diagnosis)."}
    if reason := ticket_block_reason(d, state.warning_confirmed, state.vehicle.fuel):
        return {"error": reason}
    errors, cited = [], {}
    for r in references or []:
        hit = state.hits.get(r.get("ref", ""))
        if hit is None:
            errors.append(f"ref {r.get('ref')!r} не найден в результатах search_manual")
        elif not quote_in(r.get("quote", ""), hit.text):
            errors.append(f"цитата для {hit.ref} не совпадает с текстом фрагмента дословно")
        else:
            cited[hit.ref] = hit
    if not cited:
        errors.append("нет ни одной подтверждённой ссылки на руководство: заявка не создаётся")
    loose = numbers(" ".join(operations)) - set().union(*(numbers(h.text) for h in cited.values()))
    if loose:
        errors.append("в работах числа не из процитированных фрагментов: " + ", ".join(sorted(loose)))
    if not operations:
        errors.append("список работ пуст")
    ban = None
    if operation_ban:
        hit = state.hits.get(operation_ban.get("ref", ""))
        quote = operation_ban.get("quote", "")
        if hit is None or not quote_in(quote, hit.text) or not OPERATION_BAN.search(quote):
            errors.append("operation_ban: нужна дословная цитата прямого запрета из найденного фрагмента")
        else:
            cited[hit.ref] = hit
            ban = {"manual": hit.manual, "pdf_page": hit.pdf_page, "quote": quote}
    if errors:
        return {"error": "Заявка не создана: " + "; ".join(errors)}

    level = urgency(d.anomaly_type, d.anomaly_score, operation_banned=ban is not None)
    payload = TicketCreate(
        vehicle_id=d.vehicle_id,
        session_id=d.session_id,
        anomaly_type=d.anomaly_type,
        conclusion=conclusion,
        urgency=level,
        operations=operations,
        spare_parts=spare_parts,
        references=[Reference(manual=h.manual, pdf_page=h.pdf_page) for h in cited.values()],
    )
    try:
        created = await MockToirClient().create_ticket(payload)
    except httpx.HTTPError as exc:
        return {"error": f"ТОиР не принял заявку: {exc}"}
    ticket = {"ticket_id": created.ticket_id, **payload.model_dump(), "operation_ban": ban}
    TICKETS_BY_VEHICLE[d.vehicle_id].append(ticket)
    return {"ticket_id": created.ticket_id, "urgency": level, "urgency_meaning": URGENCY_MEANING[level]}


HANDLERS = {"get_diagnosis": get_diagnosis, "search_manual": search_manual, "create_ticket": create_ticket}


async def run_tool(state: AgentState, name: str, arguments: str) -> dict:
    handler = HANDLERS.get(name)
    if handler is None:
        return {"error": f"Нет инструмента {name}"}
    try:
        args = json.loads(arguments or "{}")
        return await handler(state, **args)
    except (json.JSONDecodeError, TypeError, ValidationError) as exc:
        return {"error": f"Неверные аргументы {name}: {exc}"}
    except httpx.HTTPError as exc:
        return {"error": f"Внешний сервис недоступен: {exc}"}
