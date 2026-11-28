"""Agent tools: diagnosis, manual search, defect ticket. The LLM decides which to call;
the product rules (domain/diagnostic_rules.py) and source checks are enforced here, not in the prompt."""
import asyncio
import json
from dataclasses import dataclass, field

import httpx
from pydantic import ValidationError

from app.agent.checks import numbers, quote_in, rounding_only
from app.agent.plan import WorkPlan, results, results_line
from app.domain.diagnostic_rules import (
    OPERATION_BAN,
    URGENCY_MEANING,
    assess,
    ticket_block_reason,
    urgency,
)
from app.integrations.mock_ml_client import MockMLClient
from app.integrations.mock_toir_client import MockToirClient
from app.rag import pages
from app.rag.search import Hit, get_index
from app.repositories import store
from app.schemas.diagnostics import DiagnoseRequest, DiagnoseResponse
from app.schemas.tickets import Reference, TicketCreate
from app.schemas.vehicles import Vehicle


@dataclass
class AgentState:
    vehicle: Vehicle
    session_id: str
    diagnosis: DiagnoseResponse | None = None
    hits: dict[str, Hit] = field(default_factory=dict)
    warning_confirmed: bool = False  # set by the mechanic's explicit confirmation in the UI
    plan: "WorkPlan | None" = None  # filled by the background plan builder (services/plan_service.py)
    conversation_id: str = ""  # also the work id; used to file disputes and book entries
    contradictions: list = field(default_factory=list)  # this turn: verified conflicting quotes
    photo_check: dict | None = None  # this turn: what the photo shows vs this vehicle's engine


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "check_photo",
            "description": (
                "Обязательно первым, если механик приложил фото: что на фото (двигатель или узел) и похоже ли это "
                "на двигатель этой машины. matches: yes — похоже; no — явно другой двигатель/узел не этой машины; "
                "unclear — по фото не понять."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "shows": {"type": "string", "description": "Что на фото, коротко: узел и, если видно, двигатель."},
                    "matches": {"type": "string", "enum": ["yes", "no", "unclear"]},
                    "reason": {"type": "string", "description": "Почему: какие признаки совпадают или нет."},
                },
                "required": ["shows", "matches", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "report_contradiction",
            "description": (
                "Если найденные фрагменты руководств противоречат друг другу (разные нормы, порядок, допуски для "
                "одного и того же) — сообщи: две и более дословные цитаты с ref, что именно расходится и насколько это "
                "важно (severity). Случай попадёт в журнал спорных ситуаций; важные механик увидит на нужных шагах."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "note": {"type": "string", "description": "Что расходится, одной фразой."},
                    "severity": {"type": "string", "enum": ["critical", "minor"], "description": (
                        "critical — меняет то, что делает механик: разные нормы больше чем на 5 %, разный порядок работ, "
                        "одно руководство запрещает или требует то, чего нет в другом. minor — по сути одно и то же: "
                        "та же норма в других единицах или округлённая при пересчёте (5,6…6,2 кгс·м = 54,9…60,8 Н·м), "
                        "разные формулировки.")},
                    "recommendation": {"type": "string", "description": (
                        "Чего придерживаться и почему, 1–2 фразы — инженерная оценка, не из руководства: например, "
                        "более конкретный документ (руководство по ремонту для ремонтных работ), более новая редакция, "
                        "более безопасный или строгий вариант. Новых чисел не придумывай — только одна из сторон.")},
                    "sides": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"ref": {"type": "string"}, "quote": {"type": "string"}},
                            "required": ["ref", "quote"],
                        },
                    },
                },
                "required": ["note", "sides"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "view_page",
            "description": (
                "Посмотреть изображение страницы руководства: рисунки, чертежи, схемы, таблицы. Нужен, чтобы "
                "сравнить фото механика с чертежом, найти деталь на рисунке или прочитать таблицу. "
                "ref — ключ страницы из search_manual. Изображение придёт следующим сообщением."
            ),
            "parameters": {"type": "object", "properties": {"ref": {"type": "string"}}, "required": ["ref"]},
        },
    },
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
                "Код неисправности, проверка, приоритет и результаты проверок механика по плану диагностики "
                "подставляются автоматически."
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
    verdict = assess(d, state.vehicle.fuel, state.warning_confirmed)
    log_check_disputes(d, verdict, state.conversation_id)
    return {**d.model_dump(), **verdict}


def log_check_disputes(d: DiagnoseResponse, verdict: dict, work_id: str = "") -> None:
    """A check the product refuses to act on is worth a look by the chief mechanic (once per check)."""
    kind = {"low_confidence": "low_confidence", "fuel_mismatch": "fuel_mismatch"}.get(verdict.get("block_code") or "")
    if kind:
        detail = f"{d.session_id}: {d.anomaly_type} {d.anomaly_title}, уверенность {d.confidence}"
        if not store.has_dispute(kind, d.vehicle_id, detail):
            store.add_dispute(kind, detail, d.vehicle_id, work_id or None, {**verdict, "session_id": d.session_id})


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
        store.add_dispute("ticket_rejected", "; ".join(errors), d.vehicle_id, state.conversation_id or None,
                          {"conclusion": conclusion, "operations": operations, "references": references})
        return {"error": "Заявка не создана: " + "; ".join(errors)}

    level = urgency(d.anomaly_type, d.anomaly_score, operation_banned=ban is not None)
    # What the mechanic found by the diagnosis plan goes with the ticket (the ТОиР contract has no field for it).
    checked = results_line(results(state.plan, store.work_progress(state.conversation_id))) if state.plan else ""
    payload = TicketCreate(
        vehicle_id=d.vehicle_id,
        session_id=d.session_id,
        anomaly_type=d.anomaly_type,
        conclusion=conclusion.strip() + (f"\n{checked}" if checked else ""),
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
    store.add_entry(d.vehicle_id, "ticket", f"Заявка {created.ticket_id}", conclusion, ticket,
                    work_id=state.conversation_id or None, session_id=d.session_id)
    return {"ticket_id": created.ticket_id, "urgency": level, "urgency_meaning": URGENCY_MEANING[level]}


async def view_page(state: AgentState, ref: str) -> dict:
    """The page image goes to the model as a separate message (tool results are text only)."""
    hit = state.hits.get(ref)
    if hit is None:
        return {"error": f"Страница {ref} не из результатов search_manual — сначала найдите её поиском."}
    try:
        png = await asyncio.to_thread(pages.page_png, hit.manual_id, hit.pdf_page, 1000)
    except (LookupError, OSError) as exc:
        return {"error": f"Не удалось открыть страницу: {exc}"}
    return {"ok": True, "ref": ref, "note": "Изображение страницы приложено следующим сообщением.", "_image": png}


async def check_photo(state: AgentState, shows: str, matches: str, reason: str) -> dict:
    v = state.vehicle
    state.photo_check = {"shows": shows, "matches": matches if matches in ("yes", "no", "unclear") else "unclear",
                         "reason": reason, "engine": v.engine_model}
    if state.photo_check["matches"] == "no":
        store.add_dispute("photo_mismatch", f"На фото: {shows}. Машина: {v.vehicle_id}, {v.engine_model}. {reason}",
                          v.vehicle_id, state.conversation_id or None, state.photo_check)
        return {"ok": True, "note": "Предупреди механика первой строкой: фото не похоже на двигатель этой машины; "
                                    "рекомендации — только по руководству на её двигатель."}
    return {"ok": True}


async def report_contradiction(state: AgentState, note: str, sides: list[dict], severity: str = "critical",
                               recommendation: str = "") -> dict:
    verified, errors = [], []
    for side in sides or []:
        hit = state.hits.get(side.get("ref", ""))
        if hit is None or not quote_in(side.get("quote", ""), hit.text):
            errors.append(f"{side.get('ref')}: цитата не дословна или страница не найдена")
        else:
            verified.append({"manual_id": hit.manual_id, "manual": hit.short, "pdf_page": hit.pdf_page,
                             "quote": side["quote"]})
    if len(verified) < 2:
        return {"error": "Нужны минимум две дословные цитаты из найденных фрагментов. " + "; ".join(errors)}
    rounding = rounding_only([s["quote"] for s in verified])
    severity = "minor" if rounding or severity == "minor" else "critical"
    item = {"note": note, "sides": verified, "severity": severity, "recommendation": recommendation.strip()}
    state.contradictions.append(item)
    store.add_dispute("contradiction", note, state.vehicle.vehicle_id, state.conversation_id or None, item)
    if severity == "minor":
        return {"ok": True, "severity": "minor", "note": (
            "Записано как мелкое расхождение" + (" (числа отличаются меньше чем на 5 % — это пересчёт единиц или "
                                                 "округление, норма одна)" if rounding else "") +
            ". В шагах и ответе его не выделяй и предупреждение не пиши; если нужна норма — дай её по одному "
            "фрагменту со ссылкой.")}
    return {"ok": True, "severity": "critical", "note": (
        "Покажи механику оба варианта со страницами, затем отдельной строкой «Рекомендация (не из руководства): …» — "
        "чего придерживаться и почему, и посоветуй уточнить у производителя.")}


HANDLERS = {
    "check_photo": check_photo,
    "report_contradiction": report_contradiction,
    "get_diagnosis": get_diagnosis,
    "search_manual": search_manual,
    "view_page": view_page,
    "create_ticket": create_ticket,
}


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
