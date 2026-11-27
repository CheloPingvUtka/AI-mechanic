"""Work plan for one check, filled in the background: what to prepare, then steps from the manual.

Preliminary items (the model's engineering experience, shown as such) may not contain numbers.
Confirmed items and every step need a verbatim quote from a retrieved fragment; numbers in their
text and the measurement range must come from that fragment.
"""
import itertools
import time
from dataclasses import asdict, dataclass, field

from app.agent.checks import numbers, quote_in
from app.rag import pages

SECTIONS = ("tools", "materials", "safety", "steps")
_ids = itertools.count(1)


@dataclass
class Measure:
    name: str
    unit: str
    min: float | None = None
    max: float | None = None


@dataclass
class PlanItem:
    text: str
    preliminary: bool
    ref: str | None = None
    quote: str | None = None
    manual_id: str | None = None
    manual: str | None = None
    pdf_page: int | None = None
    measure: Measure | None = None
    figures: int = 0  # pictures cut out of that page, for the step card
    id: int = field(default_factory=lambda: next(_ids))
    added_at: float = field(default_factory=time.time)


@dataclass
class WorkPlan:
    tools: list[PlanItem] = field(default_factory=list)
    materials: list[PlanItem] = field(default_factory=list)
    safety: list[PlanItem] = field(default_factory=list)
    steps: list[PlanItem] = field(default_factory=list)
    status: str = "building"  # building | ready | failed
    note: str = ""
    note_code: str = ""  # set when no plan is needed (block code), so the UI can translate the note
    version: int = 0

    def snapshot(self) -> dict:
        return asdict(self)


UPDATE_PLAN = {
    "type": "function",
    "function": {
        "name": "update_plan",
        "description": (
            "Добавить или заменить пункты рабочего плана механика. Разделы: tools — инструмент и приспособления, "
            "materials — запчасти и расходники, safety — меры безопасности, steps — шаги проверки/ремонта по порядку. "
            "preliminary=true — предварительно, по инженерному опыту: без ref и без чисел. preliminary=false — "
            "из руководства: ref и дословная quote из найденного фрагмента; числа в тексте и границы measure — "
            "только из этого фрагмента. steps всегда preliminary=false. replace=true заменяет весь раздел."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "section": {"type": "string", "enum": list(SECTIONS)},
                "preliminary": {"type": "boolean"},
                "replace": {"type": "boolean"},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "ref": {"type": "string"},
                            "quote": {"type": "string"},
                            "measure": {
                                "type": "object",
                                "description": "Только для шага с замером: что меряем и норма из фрагмента.",
                                "properties": {
                                    "name": {"type": "string"},
                                    "unit": {"type": "string"},
                                    "min": {"type": "number"},
                                    "max": {"type": "number"},
                                },
                                "required": ["name", "unit"],
                            },
                        },
                        "required": ["text"],
                    },
                },
            },
            "required": ["section", "preliminary", "items"],
        },
    },
}

FINISH_PLAN = {
    "type": "function",
    "function": {
        "name": "finish_plan",
        "description": "План готов. note — одна-две фразы механику: что найдено, чего нет в руководстве.",
        "parameters": {"type": "object", "properties": {"note": {"type": "string"}}, "required": ["note"]},
    },
}


def check_item(raw: dict, preliminary: bool, section: str, hits: dict) -> tuple[PlanItem | None, str | None]:
    text = (raw.get("text") or "").strip()
    if not text:
        return None, "пустой пункт"
    if preliminary:
        if section == "steps":
            return None, f"«{text[:40]}»: шаги — только из руководства (preliminary=false)"
        if numbers(text):
            return None, f"«{text[:40]}»: в предварительном пункте не должно быть чисел"
        return PlanItem(text=text, preliminary=True), None
    hit = hits.get(raw.get("ref") or "")
    if hit is None:
        return None, f"«{text[:40]}»: ref не из результатов search_manual"
    if not quote_in(raw.get("quote") or "", hit.text):
        return None, f"«{text[:40]}»: цитата не совпадает с фрагментом {hit.ref} дословно"
    allowed = numbers(hit.text)
    loose = numbers(text) - allowed
    if loose:
        return None, f"«{text[:40]}»: числа {', '.join(sorted(loose))} не из фрагмента {hit.ref}"
    measure = None
    if m := raw.get("measure"):
        bounds = [b for b in (m.get("min"), m.get("max")) if b is not None]
        if not bounds:
            return None, f"«{text[:40]}»: у замера нет нормы (min/max)"
        if any(float(b) not in {float(x) for x in allowed} for b in bounds):
            return None, f"«{text[:40]}»: норма замера не из фрагмента {hit.ref}"
        measure = Measure(name=m.get("name", ""), unit=m.get("unit", ""), min=m.get("min"), max=m.get("max"))
    try:
        figures = len(pages.figures(hit.manual_id, hit.pdf_page))
    except (LookupError, OSError):
        figures = 0
    return PlanItem(text=text, preliminary=False, ref=hit.ref, quote=raw.get("quote"), manual_id=hit.manual_id,
                    manual=hit.short, pdf_page=hit.pdf_page, measure=measure, figures=figures), None


def update_plan(plan: WorkPlan, hits: dict, section: str, preliminary: bool, items: list[dict],
                replace: bool = False) -> dict:
    if section not in SECTIONS:
        return {"error": f"Нет раздела {section}"}
    accepted, rejected = [], []
    for raw in items or []:
        item, why = check_item(raw, preliminary, section, hits)
        if item:
            accepted.append(item)
        else:
            rejected.append(why)
    current: list[PlanItem] = getattr(plan, section)
    if replace and accepted:
        current.clear()
    known = {i.text.lower() for i in current}
    current.extend(i for i in accepted if i.text.lower() not in known)
    plan.version += 1
    return {"accepted": len(accepted), "rejected": rejected}
