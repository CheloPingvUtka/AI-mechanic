from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from app.repositories import store
from app.repositories.vehicle_catalog import JsonVehicleCatalog

router = APIRouter()


class NewEntry(BaseModel):
    kind: Literal["note", "fault", "defect", "repair", "recommendation", "recheck"] = "note"
    title: str = Field("", max_length=200)
    text: str = Field("", max_length=4000)
    photos: list[str] = Field([], max_length=8, description="data:image/jpeg;base64,… (shrunk on the device)")
    work_id: str | None = None

    @field_validator("photos")
    @classmethod
    def data_urls(cls, photos: list[str]) -> list[str]:
        for url in photos:
            if not url.startswith(("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")):
                raise ValueError("фото должно быть data URL jpeg/png/webp")
            if len(url) > 3_000_000:
                raise ValueError("фото больше ~2 МБ")
        return photos


@router.get("/book/{vehicle_id}", summary="Сервисная книжка: записи из базы + история проверок, новые сверху")
def get_book(vehicle_id: str):
    vehicle = JsonVehicleCatalog().get_vehicle(vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=404, detail="Транспортное средство не найдено")
    entries = store.entries(vehicle_id)
    booked = {e["session_id"] for e in entries if e["kind"] in ("diagnosis", "recheck")}
    history = [{
        "id": None, "vehicle_id": vehicle_id, "work_id": None, "session_id": s.session_id,
        "created_at": s.checked_at.timestamp(), "kind": "diagnosis",
        "title": f"{s.anomaly_type} {s.anomaly_title}" if s.anomaly_type else ("Норма" if s.status == "normal" else "Сбой записи"),
        "text": s.description, "data": s.model_dump(mode="json"), "photos": [], "source": "history",
    } for s in vehicle.sessions if s.session_id not in booked]
    items = sorted(entries + history, key=lambda e: e["created_at"], reverse=True)
    return {"vehicle": vehicle.model_dump(mode="json", exclude={"sessions"}), "entries": items,
            "works": store.list_works(vehicle_id)}


@router.post("/book/{vehicle_id}/entries", status_code=201, summary="Добавить запись (заметку) с фото")
def add_entry(vehicle_id: str, payload: NewEntry):
    if JsonVehicleCatalog().get_vehicle(vehicle_id) is None:
        raise HTTPException(status_code=404, detail="Транспортное средство не найдено")
    title = payload.title or {"note": "Заметка механика"}.get(payload.kind, payload.kind)
    entry_id = store.add_entry(vehicle_id, payload.kind, title, payload.text, None, work_id=payload.work_id)
    photo_ids = [store.add_photo(vehicle_id, url, entry_id, payload.work_id) for url in payload.photos]
    return {"id": entry_id, "photos": photo_ids}


@router.get("/photos/{photo_id}", summary="Фото из сервисной книжки")
def get_photo(photo_id: int):
    path = store.photo_file(photo_id)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Нет фото")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


@router.get("/disputes", summary="Журнал спорных ситуаций")
def list_disputes(resolved: bool | None = None, vehicle_id: str | None = None):
    return store.disputes(resolved, vehicle_id)


class Resolve(BaseModel):
    resolved: bool = True


@router.patch("/disputes/{dispute_id}", summary="Отметить спорную ситуацию разобранной")
def resolve(dispute_id: int, payload: Resolve):
    try:
        store.resolve_dispute(dispute_id, payload.resolved)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}
