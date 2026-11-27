"""Pictures for steps. The model looks at the drawings cut out of the cited page and its neighbours and
picks the one that shows that step's part, tool or action, or none: never "the first picture on the page"."""
import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass

from app.agent.meter import TokenMeter
from app.integrations.llm_client import LLMClient, LLMError
from app.rag import pages
from app.rag.manuals import BY_ID
from app.rag.search import get_index

log = logging.getLogger(__name__)

NEAR = (0, 1, -1)  # the cited page first, then the next one (drawings often follow the text), then the previous
MAX_CANDIDATES = 6
MAX_STEPS = 16
MAX_SECOND = 8  # steps that get a second look across the manual
PROMPT = """Ты подбираешь иллюстрации к шагам инструкции по ремонту двигателя.
Даны шаги и пронумерованные рисунки из руководства (с подписями, если они есть).
Для каждого шага выбери рисунок, на котором виден именно тот узел, деталь, инструмент или действие, о котором шаг.
Если ни один рисунок не показывает это — null. Не выбирай рисунок только потому, что он на той же странице:
лучше null, чем неверная картинка. Один рисунок может подойти нескольким шагам.
Ответ — только JSON: {"picks": {"<id шага>": <номер рисунка или null>}}"""


@dataclass(frozen=True)
class Pick:
    pdf_page: int
    figure: int


_cache: dict[tuple, Pick | None] = {}


def candidates(manual_id: str, page: int) -> list[tuple[int, int]]:
    """(page, figure index) of the drawings near a cited page."""
    out = []
    for p in (page + d for d in NEAR):
        try:
            out += [(p, i) for i in range(len(pages.figures(manual_id, p)))]
        except (LookupError, OSError):
            continue
    return out[:MAX_CANDIDATES]


def _parse(content: str, keys: list[str], cands: list[tuple[int, int]]) -> dict[str, Pick | None]:
    match = re.search(r"\{.*\}", content or "", re.S)
    try:
        picks = json.loads(match.group(0)).get("picks", {}) if match else {}
    except (json.JSONDecodeError, AttributeError):
        picks = {}
    out = {}
    for key in keys:
        n = picks.get(key)
        out[key] = Pick(*cands[n - 1]) if isinstance(n, int) and 1 <= n <= len(cands) else None
    return out


def found_elsewhere(manual_id: str, page: int, text: str) -> list[tuple[int, int]]:
    """Drawings on the pages the manual search finds for this step (away from the cited page)."""
    manual = BY_ID.get(manual_id)
    if manual is None:
        return []
    seen: list[int] = []
    for hit in get_index().search(manual.engines[0], text, k=8):
        if hit.manual_id == manual_id and abs(hit.pdf_page - page) > 1 and hit.pdf_page not in seen:
            seen.append(hit.pdf_page)
    out = []
    for p in seen[:4]:
        try:
            out += [(p, i) for i in range(len(pages.figures(manual_id, p)))]
        except (LookupError, OSError):
            continue
    return out[:MAX_CANDIDATES]


async def _ask(llm: LLMClient, manual_id: str, cands: list[tuple[int, int]], items: list[tuple[str, str]],
               meter: TokenMeter | None = None, emit=None, second: bool = False) -> tuple[dict, dict]:
    """Shows the model the steps and the candidate drawings; returns its picks. Tells the UI what it looks at."""
    look = f"{manual_id}:{cands[0][0]}:{items[0][0]}:{int(second)}"
    if emit:
        emit({"type": "figures_look", "id": look, "manual_id": manual_id, "manual": BY_ID[manual_id].short if manual_id in BY_ID else manual_id,
              "pages": sorted({p for p, _ in cands}), "count": len(cands), "steps": len(items), "second": second})
    content: list[dict] = [{"type": "text", "text": "Шаги:\n" + "\n".join(f"{key}: {text}" for key, text in items)}]
    for n, (p, i) in enumerate(cands, 1):
        caption = await asyncio.to_thread(pages.caption, manual_id, p, i)
        png = await asyncio.to_thread(pages.page_png, manual_id, p, 512, i)
        content += [{"type": "text", "text": f"Рисунок {n} (стр. {p})" + (f", подпись: {caption}" if caption else "")},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}}]
    messages = [{"role": "system", "content": PROMPT}, {"role": "user", "content": content}]
    message, usage = await (meter.call(llm, messages, None) if meter else llm.chat(messages, None))
    picks = _parse(message.get("content") or "", [key for key, _ in items], cands)
    if emit:
        emit({"type": "figures_seen", "id": look, "picked": sum(1 for p in picks.values() if p)})
    return picks, usage


async def pick(steps: list[tuple[str, str, str, int]], meter: TokenMeter | None = None,
               emit=None) -> tuple[dict[str, Pick | None], dict]:
    """steps: (key, text, manual_id, pdf_page). Round 1: drawings near the cited page, one model call per page.
    Round 2, for steps nothing fitted: drawings on other pages the manual search finds for that step.
    Returns picks (None = no fitting drawing) and the summed usage."""
    out: dict[str, Pick | None] = {}
    todo, answered = [], set()
    for step in steps[:MAX_STEPS]:
        key, text, manual_id, page = step
        if (manual_id, page, text) in _cache:
            out[key] = _cache[(manual_id, page, text)]
        else:
            todo.append(step)
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "cost": 0.0}
    llm = LLMClient()

    async def run(jobs: list[tuple[str, list, list]], second: bool = False) -> None:
        results = await asyncio.gather(*(_ask(llm, m, cands, items, meter, emit, second) for m, cands, items in jobs),
                                       return_exceptions=True)
        for (manual_id, _, items), result in zip(jobs, results):
            if isinstance(result, (LLMError, OSError, LookupError)):
                log.warning("figure pick in %s failed: %s", manual_id, result)
                continue
            if isinstance(result, BaseException):
                raise result
            picks, used = result
            for k in usage:
                usage[k] += used.get(k) or 0
            out.update(picks)
            answered.update(picks)

    groups: dict[tuple[str, int], list[tuple[str, str]]] = {}
    for key, text, manual_id, page in todo:
        groups.setdefault((manual_id, page), []).append((key, text))
    jobs = []
    for (manual_id, page), items in groups.items():
        if cands := await asyncio.to_thread(candidates, manual_id, page):
            jobs.append((manual_id, cands, items))
        else:
            answered.update(key for key, _ in items)
    await run(jobs)
    jobs = []
    for key, text, manual_id, page in todo:
        if out.get(key) is None and len(jobs) < MAX_SECOND:
            if cands := await asyncio.to_thread(found_elsewhere, manual_id, page, text):
                jobs.append((manual_id, cands, [(key, text)]))
    await run(jobs, second=True)
    for key, text, manual_id, page in todo:
        out.setdefault(key, None)
        if key in answered:
            _cache[(manual_id, page, text)] = out[key]
    return out, usage
