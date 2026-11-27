"""Page images and figures from the local manual PDFs (never committed; served only from KNOWLEDGE_BASE_PATH).

Raster figures are cut out by the bounds of the image objects on the page; tiled images are merged.
Vector drawings are found the way a person sees them: render the page small, erase every text glyph,
and take the large connected areas of ink that are left; areas dense with text are tables, not
drawings. Scans without a text layer are skipped (the whole page is the picture there).
"""
import hashlib
import io
import threading
from collections import deque
from functools import lru_cache
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from PIL import Image, ImageDraw, ImageFilter

from app.core.config import settings
from app.rag.manuals import BY_ID

_lock = threading.Lock()  # pdfium is not thread-safe; FastAPI runs sync endpoints in a thread pool
_docs: dict[str, pdfium.PdfDocument] = {}
MIN_FIGURE, MAX_FIGURE, GAP = 0.03, 0.9, 6.0  # share of page area; merge distance in PDF points
DETECT_SCALE, CELL = 0.5, 4  # vector detection: render at 36 dpi, 4 px cells (~8 pt)
MAX_TEXT_DENSITY = 1000  # chars per whole-page area inside a region; drawings ~80-800, tables ~1400+
MAX_GRID_TEXT_DENSITY = 300  # a line grid with this much text is a table (rotated tables ~780-990, drawing ~80)


def kb_path() -> Path:
    return Path(settings.knowledge_base_path).expanduser()


def _doc(manual_id: str) -> pdfium.PdfDocument:
    if manual_id not in BY_ID:
        raise LookupError(f"Нет руководства {manual_id}")
    if manual_id not in _docs:
        _docs[manual_id] = pdfium.PdfDocument(kb_path() / BY_ID[manual_id].file)
    return _docs[manual_id]


def _page(manual_id: str, page: int):
    doc = _doc(manual_id)
    if not 1 <= page <= len(doc):
        raise LookupError(f"В {manual_id} нет страницы {page}")
    return doc[page - 1]


def page_count(manual_id: str) -> int:
    with _lock:
        return len(_doc(manual_id))


def merge_boxes(boxes: list[tuple[float, float, float, float]], gap: float = GAP) -> list[tuple]:
    """Union boxes that touch or overlap (within gap) into clusters."""
    clusters = [list(b) for b in boxes]
    merged = True
    while merged:
        merged = False
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                a, b = clusters[i], clusters[j]
                if a[0] - gap <= b[2] and b[0] - gap <= a[2] and a[1] - gap <= b[3] and b[1] - gap <= a[3]:
                    clusters[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                    del clusters[j]
                    merged = True
                    break
            if merged:
                break
    return [tuple(c) for c in clusters]


def _is_grid(px, x0: int, y0: int, x1: int, y1: int, fill: float = 0.85) -> bool:
    """A table: near-solid lines across the region in both directions — at least 2 each and 5 in total
    (a rotated table has 2 border rows and 3+ columns; drawings measured at most 1 such line)."""
    w, h = x1 - x0 + 1, y1 - y0 + 1
    rows = sum(sum(px[x, y] < 245 for x in range(x0, x1 + 1)) >= fill * w for y in range(y0, y1 + 1))
    cols = sum(sum(px[x, y] < 245 for y in range(y0, y1 + 1)) >= fill * h for x in range(x0, x1 + 1))
    return rows >= 2 and cols >= 2 and rows + cols >= 5


def ink_regions(image: Image.Image, glyphs: list[tuple], height: float, scale: float = DETECT_SCALE) -> list[tuple]:
    """Connected areas of non-text ink on a rendered page: ((left, bottom, right, top) in PDF points, is_grid)."""
    draw = ImageDraw.Draw(image)
    for l, b, r, t in glyphs:
        if r - l < 40 and t - b < 40:  # erase glyphs, not huge boxes
            draw.rectangle([l * scale - 1, (height - t) * scale - 1, r * scale + 1, (height - b) * scale + 1], fill=255)
    ink = image.point(lambda v: 0 if v < 170 else 255)
    gw, gh = max(1, ink.width // CELL), max(1, ink.height // CELL)
    cells = ink.resize((gw, gh), Image.Resampling.BOX)
    grid = cells.filter(ImageFilter.MinFilter(3))  # join nearby strokes
    px, raw, seen, regions, k = grid.load(), cells.load(), set(), [], CELL / scale
    for y in range(gh):
        for x in range(gw):
            if px[x, y] >= 245 or (x, y) in seen:
                continue
            queue, (x0, x1, y0, y1) = deque([(x, y)]), (x, x, y, y)
            seen.add((x, y))
            while queue:
                cx, cy = queue.popleft()
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < gw and 0 <= ny < gh and (nx, ny) not in seen and px[nx, ny] < 245:
                        seen.add((nx, ny))
                        queue.append((nx, ny))
            box = (x0 * k, height - (y1 + 1) * k, (x1 + 1) * k, height - y0 * k)
            regions.append((box, _is_grid(raw, x0, y0, x1, y1)))  # lines judged on undilated cells
    return regions


def _overlaps(a: tuple, b: tuple) -> bool:
    """More than half of the smaller box lies inside the other."""
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return w > 0 and h > 0 and w * h > 0.5 * smaller


@lru_cache(maxsize=4096)
def figures(manual_id: str, page: int) -> tuple[tuple[float, float, float, float], ...]:
    """Figure boxes (left, bottom, right, top in PDF points), top of the page first."""
    with _lock:
        pg = _page(manual_id, page)
        width, height = pg.get_size()
        boxes = [o.get_bounds() for o in pg.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_IMAGE,), max_depth=4)]
        textpage = pg.get_textpage()
        glyphs = [textpage.get_charbox(i) for i in range(textpage.count_chars())]
        rendered = pg.render(scale=DETECT_SCALE, grayscale=True).to_pil().convert("L") if len(glyphs) >= 50 else None
        area = width * height
        found = [b for b in merge_boxes(boxes) if MIN_FIGURE <= (b[2] - b[0]) * (b[3] - b[1]) / area <= MAX_FIGURE]
        for r, grid in ink_regions(rendered, glyphs, height) if rendered else []:
            w, h = r[2] - r[0], r[3] - r[1]
            share = w * h / area
            if w < width * 0.12 or h < height * 0.06 or not MIN_FIGURE <= share <= MAX_FIGURE:
                continue
            chars = len(textpage.get_text_bounded(left=r[0], bottom=r[1], right=r[2], top=r[3]).strip())
            limit = MAX_GRID_TEXT_DENSITY if grid else MAX_TEXT_DENSITY
            if chars / share <= limit and not any(_overlaps(r, f) for f in found):
                found.append(r)
    return tuple(sorted(found, key=lambda b: -b[3]))


def _cache_file(name: str) -> Path:
    path = kb_path() / "index" / "images" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def highlight_boxes(textpage, text: str) -> list[tuple]:
    """Where the quoted text sits on the page (PDF points). Searched line by line, since a quote can
    span lines and our cleaned text has hyphenation removed; lines too short to be unique are skipped."""
    boxes = []
    for line in {ln.strip() for ln in text.splitlines() if len(ln.strip()) >= 12}:
        searcher = textpage.search(line[:120], match_case=False)
        while (found := searcher.get_next()) is not None:
            start, count = found
            boxes += [textpage.get_rect(i) for i in range(textpage.count_rects(start, count))]
    return boxes


def page_png(manual_id: str, page: int, width: int = 1000, figure: int | None = None,
             highlight: str | None = None) -> bytes:
    """PNG of a page (or of one figure on it), rendered once and cached next to the index.
    `highlight`: text to mark in yellow (the quote an answer relies on)."""
    width = max(200, min(width, 2000))
    mark = hashlib.sha1(highlight.encode()).hexdigest()[:10] if highlight else "x"
    cached = _cache_file(f"{manual_id}-{page}-{figure if figure is not None else 'p'}-{width}-{mark}.png")
    if cached.is_file():
        return cached.read_bytes()
    box = None
    if figure is not None:
        boxes = figures(manual_id, page)
        if not 0 <= figure < len(boxes):
            raise LookupError(f"На странице {page} нет рисунка {figure}")
        box = boxes[figure]
    with _lock:
        pg = _page(manual_id, page)
        pw, ph = pg.get_size()
        scale = width / ((box[2] - box[0]) if box else pw)
        crop = (0, 0, 0, 0) if box is None else (box[0], box[1], pw - box[2], ph - box[3])
        image = pg.render(scale=scale, crop=crop).to_pil().convert("RGB")
        marks = highlight_boxes(pg.get_textpage(), highlight) if highlight else []
    if marks:
        overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        for l, b, r, t in marks:
            x0, y0 = (l - crop[0]) * scale, (ph - crop[3] - t) * scale
            draw.rectangle([x0 - 2, y0 - 2, (r - crop[0]) * scale + 2, (ph - crop[3] - b) * scale + 2],
                           fill=(255, 214, 0, 110))
        image = Image.alpha_composite(image.convert("RGBA"), overlay)
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG", optimize=True)
    cached.write_bytes(buf.getvalue())
    return buf.getvalue()
