"""Page images and figures from the local manual PDFs (never committed; served only from KNOWLEDGE_BASE_PATH).

Raster figures are cut out by the bounds of the image objects on the page; tiled images are merged.
Vector drawings have no image objects, so for them the whole page is the picture.
"""
import io
import threading
from functools import lru_cache
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

from app.core.config import settings
from app.rag.manuals import BY_ID

_lock = threading.Lock()  # pdfium is not thread-safe; FastAPI runs sync endpoints in a thread pool
_docs: dict[str, pdfium.PdfDocument] = {}
MIN_FIGURE, MAX_FIGURE, GAP = 0.03, 0.9, 6.0  # share of page area; merge distance in PDF points


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


@lru_cache(maxsize=2048)
def figures(manual_id: str, page: int) -> tuple[tuple[float, float, float, float], ...]:
    """Figure boxes (left, bottom, right, top in PDF points), top of the page first."""
    with _lock:
        pg = _page(manual_id, page)
        width, height = pg.get_size()
        boxes = [o.get_bounds() for o in pg.get_objects(filter=(pdfium_c.FPDF_PAGEOBJ_IMAGE,), max_depth=4)]
    area = width * height
    keep = [b for b in merge_boxes(boxes) if MIN_FIGURE <= (b[2] - b[0]) * (b[3] - b[1]) / area <= MAX_FIGURE]
    return tuple(sorted(keep, key=lambda b: -b[3]))


def _cache_file(name: str) -> Path:
    path = kb_path() / "index" / "images" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def page_png(manual_id: str, page: int, width: int = 1000, figure: int | None = None) -> bytes:
    """PNG of a page (or of one figure on it), rendered once and cached next to the index."""
    width = max(200, min(width, 2000))
    cached = _cache_file(f"{manual_id}-{page}-{figure if figure is not None else 'p'}-{width}.png")
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
        image = pg.render(scale=scale, crop=crop).to_pil()
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG", optimize=True)
    cached.write_bytes(buf.getvalue())
    return buf.getvalue()
