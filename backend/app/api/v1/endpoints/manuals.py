from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from app.rag import pages
from app.rag.manuals import BY_ID, MANUALS

router = APIRouter()
IMMUTABLE = {"Cache-Control": "public, max-age=86400"}


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"PDF не найден: {exc}") from exc


@router.get("", summary="Руководства: обозначение, двигатели, официальный источник")
def list_manuals():
    return [
        {"id": m.id, "title": m.title, "short": m.short, "engines": m.engines, "official_url": m.official_url,
         "official_note": m.official_note}
        for m in MANUALS
    ]


@router.get("/{manual_id}/pdf", summary="Локальный PDF (откройте с #page=N)")
def manual_pdf(manual_id: str):
    manual = BY_ID.get(manual_id)
    if manual is None:
        raise HTTPException(status_code=404, detail="Нет такого руководства")
    path = pages.kb_path() / manual.file
    if not path.is_file():
        raise HTTPException(status_code=503, detail="PDF не найден в KNOWLEDGE_BASE_PATH")
    return FileResponse(path, media_type="application/pdf", headers={"Content-Disposition": "inline"})


@router.get("/{manual_id}/pages/{page}.png", summary="Изображение страницы")
def page_image(manual_id: str, page: int, w: int = 1000):
    return Response(_guard(pages.page_png, manual_id, page, w), media_type="image/png", headers=IMMUTABLE)


@router.get("/{manual_id}/pages/{page}/figures/{figure}.png", summary="Рисунок со страницы")
def figure_image(manual_id: str, page: int, figure: int, w: int = 800):
    return Response(_guard(pages.page_png, manual_id, page, w, figure), media_type="image/png", headers=IMMUTABLE)


@router.get("/{manual_id}/pages/{page}/info", summary="Страница: число рисунков на ней")
def page_info(manual_id: str, page: int):
    boxes = _guard(pages.figures, manual_id, page)
    return {"manual_id": manual_id, "pdf_page": page, "figures": len(boxes)}
