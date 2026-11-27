"""Work plan for one check, filled in the background, in three stages:
1. Подготовка: tools, materials, safety, what to remove (disassembly), preparing the vehicle and bay (prep);
2. Работа: steps from the manual;
3. Проверка: quality checklist after the repair; then aftercare recommendations.

Preliminary items (the model's engineering experience, shown as such) may not contain numbers.
Confirmed items and every step need a verbatim quote from a retrieved fragment; numbers in their
text and the measurement range must come from that fragment.
"""
import itertools
import json
import time
from dataclasses import asdict, dataclass, field

from app.agent.checks import numbers, quote_in
from app.rag import pages

SECTIONS = ("tools", "materials", "safety", "disassembly", "prep", "steps", "quality", "aftercare")
MANUAL_ONLY = ("steps",)  # instructions themselves come only from the manual
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
    figure: int | None = None  # the picture the model chose for this step (index on figure_page), None = none fits
    figure_page: int | None = None
    id: int = field(default_factory=lambda: next(_ids))
    added_at: float = field(default_factory=time.time)


@dataclass
class WorkPlan:
    tools: list[PlanItem] = field(default_factory=list)
    materials: list[PlanItem] = field(default_factory=list)
    safety: list[PlanItem] = field(default_factory=list)
    disassembly: list[PlanItem] = field(default_factory=list)
    prep: list[PlanItem] = field(default_factory=list)
    steps: list[PlanItem] = field(default_factory=list)
    quality: list[PlanItem] = field(default_factory=list)
    aftercare: list[PlanItem] = field(default_factory=list)
    conflicts: list[dict] = field(default_factory=list)  # verified contradictions between manuals
    status: str = "building"  # building | ready | failed
    note: str = ""
    note_code: str = ""  # set when no plan is needed (block code), so the UI can translate the note
    version: int = 0

    def snapshot(self) -> dict:
        return asdict(self)

    @classmethod
    def from_snapshot(cls, data: dict) -> "WorkPlan":
        def item(raw: dict) -> PlanItem:
            measure = raw.get("measure")
            return PlanItem(**{**raw, "measure": Measure(**measure) if measure else None})
        lists = {name: [item(i) for i in data.get(name) or []] for name in SECTIONS}
        scalars = {k: data[k] for k in ("status", "note", "note_code", "version", "conflicts") if k in data}
        return cls(**lists, **scalars)


UPDATE_PLAN = {
    "type": "function",
    "function": {
        "name": "update_plan",
        "description": (
            "Добавить или заменить пункты рабочего плана механика. Этап 1 «Подготовка»: tools — инструмент и "
            "приспособления; materials — запчасти и расходники; safety — меры безопасности; disassembly — что снять "
            "или разобрать, чтобы добраться до узла; prep — подготовка машины и рабочего места, по порядку. Этап 2 "
            "«Работа»: steps — шаги проверки/ремонта по порядку. Этап 3 «Проверка»: quality — контрольный список "
            "после ремонта (работы выполнены, детали установлены правильно, крепления проверены, нет посторонних "
            "предметов, двигатель готов к запуску). После: aftercare — что контролировать после ремонта, признаки "
            "неудачного ремонта, через какой пробег перепроверить, профилактика. preliminary=true — по инженерному "
            "опыту: без ref и без чисел. preliminary=false — из руководства: ref и дословная quote из найденного "
            "фрагмента; числа в тексте и границы measure — только из этого фрагмента. steps всегда "
            "preliminary=false. replace=true заменяет весь раздел."
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


def bound_from(bound: float, allowed: set[str]) -> bool:
    """A norm bound is from the fragment if it is written there or is a ± tolerance of numbers written
    there (e.g. «22,6+0,8 МПа» gives 22.6…23.4)."""
    values = {float(x) for x in allowed}
    return bound in values or any(abs(a + b - bound) < 1e-6 or abs(a - b - bound) < 1e-6
                                  for a in values for b in values if a != b)


def check_item(raw: dict, preliminary: bool, section: str, hits: dict) -> tuple[PlanItem | None, str | None]:
    text = (raw.get("text") or "").strip()
    if not text:
        return None, "пустой пункт"
    if preliminary:
        if section in MANUAL_ONLY:
            return None, f"«{text[:40]}»: шаги — только из руководства (preliminary=false)"
        if numbers(text):
            return None, f"«{text[:40]}»: в предварительном пункте не должно быть чисел"
        return PlanItem(text=text, preliminary=True), None
    hit = hits.get(raw.get("ref") or "")
    if hit is None:
        return None, f"«{text[:40]}»: ref не из результатов search_manual"
    if not quote_in(raw.get("quote") or "", hit.text):
        return None, (f"«{text[:40]}»: цитата не совпадает с фрагментом {hit.ref} дословно — скопируй кусок "
                      "текста фрагмента символ в символ (15–200 знаков) или убери пункт")
    allowed = numbers(hit.text)
    loose = numbers(text) - allowed
    if loose:
        return None, f"«{text[:40]}»: числа {', '.join(sorted(loose))} не из фрагмента {hit.ref}"
    measure = None
    if m := raw.get("measure"):
        bounds = [b for b in (m.get("min"), m.get("max")) if b is not None]
        if not bounds:
            return None, f"«{text[:40]}»: у замера нет нормы (min/max)"
        if any(not bound_from(float(b), allowed) for b in bounds):
            return None, f"«{text[:40]}»: норма замера не из фрагмента {hit.ref}"
        measure = Measure(name=m.get("name", ""), unit=m.get("unit", ""), min=m.get("min"), max=m.get("max"))
    try:
        figures = len(pages.figures(hit.manual_id, hit.pdf_page))
    except (LookupError, OSError):
        figures = 0
    return PlanItem(text=text, preliminary=False, ref=hit.ref, quote=raw.get("quote"), manual_id=hit.manual_id,
                    manual=hit.short, pdf_page=hit.pdf_page, measure=measure, figures=figures), None


def _raw_items(items) -> list[dict]:
    """The model sometimes sends the list, or items of it, as JSON strings, or bare texts instead of {"text": ...}."""
    if isinstance(items, str):
        items = [items]
    out = []
    for raw in items if isinstance(items, list) else []:
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {"text": raw}
            out.extend(_raw_items(parsed) if isinstance(parsed, list) else [parsed] if isinstance(parsed, dict) else [])
        elif isinstance(raw, dict):
            out.append(raw)
    return out


def update_plan(plan: WorkPlan, hits: dict, section: str, preliminary: bool, items: list[dict],
                replace: bool = False) -> dict:
    if section not in SECTIONS:
        return {"error": f"Нет раздела {section}"}
    accepted, rejected = [], []
    for raw in _raw_items(items):
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
