"""Post-checks of LLM output against what the manuals actually say.

Rule from the customer: every number (norms, tolerances, torques, pressures) comes from this
engine's manual with a page reference; a number without a source is an error.
"""
import re

from app.rag.search import Hit

CITE = re.compile(r"\[?\b([a-z][a-z0-9_]*:\d+)\b\]?")  # [yamz236_rk:41]; models sometimes drop the brackets
# A standalone number: not glued to letters (so "ЯМЗ-236М2" or "M333YK47" are not numbers).
_NUM = re.compile(r"(?<![\w.,])\d+(?:[.,]\d+)?(?!\w)")


def numbers(text: str) -> set[str]:
    """Multi-character numbers in text; single digits are list items and step counts, not norms."""
    return {n.replace(",", ".") for n in _NUM.findall(text) if len(n) > 1}


ROUNDING = 0.05  # 5,6…6,2 кгс·м is printed as 54,9…58,8 in one place and 54,9…60,8 Н·м in another


def _norm_values(text: str) -> list[float]:
    """Numbers that can be norms: fractions, or whole numbers from 30 up (smaller ones are list items, kgf·m
    integers that come with their N·m equivalent, counts)."""
    out = []
    for n in re.findall(r"\d+(?:[.,]\d+)?", text):
        v = float(n.replace(",", "."))
        if "," in n or "." in n or v >= 30:
            out.append(v)
    return out


def rounding_only(quotes: list[str]) -> bool:
    """The quotes give the same norms, only rounded differently (e.g. converted from kgf·m to N·m): every value
    of each quote has one within 5 % in every other, and they are not all identical. Not a real contradiction."""
    values = [_norm_values(q) for q in quotes]
    if len(values) < 2 or not all(values):
        return False

    def near(a: list[float], b: list[float]) -> bool:
        return all(any(abs(x - y) <= ROUNDING * max(x, y) for y in b) for x in a)

    pairs = [(a, b) for i, a in enumerate(values) for b in values[i + 1:]]
    return all(near(a, b) and near(b, a) for a, b in pairs) and any(set(a) != set(b) for a, b in pairs)


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def quote_in(quote: str, fragment: str) -> bool:
    q = _squash(quote)
    return len(q) >= 15 and q in _squash(fragment)


def answer_problems(answer: str, hits: dict[str, Hit], trusted_text: str) -> list[str]:
    """Unknown citation keys, and numbers that appear neither in a cited fragment nor in trusted data."""
    cited = CITE.findall(answer)
    problems = [f"ссылка [{ref}] не из результатов поиска" for ref in cited if ref not in hits]
    allowed = numbers(trusted_text)
    for ref in cited:
        if ref in hits:
            allowed |= numbers(hits[ref].text)
    loose = sorted(numbers(CITE.sub("", answer)) - allowed)
    if loose:
        problems.append("числа без процитированного источника: " + ", ".join(loose))
    return problems


def render_citations(answer: str, hits: dict[str, Hit]) -> tuple[str, list[Hit]]:
    """Replace [manual_id:page] keys with human-readable references; return the cited fragments."""
    used: dict[str, Hit] = {}

    def repl(m: re.Match) -> str:
        hit = hits.get(m.group(1))
        if hit is None:
            return ""
        used[m.group(1)] = hit
        return f"({hit.short}, стр. {hit.pdf_page})"

    return CITE.sub(repl, answer), list(used.values())
