import asyncio
import json
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.v1.endpoints.assistant import next_event
from app.repositories import store
from app.services import plan_service

router = APIRouter()


class WorkStart(BaseModel):
    vehicle_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    lang: Literal["ru", "uz", "ko"] = "ru"


@router.post("", summary="Начать работу по проверке: в фоне строится рабочий план")
async def start_work(payload: WorkStart):
    """Returns work_id; it is also the chat conversation_id, so chat and plan share what was found."""
    try:
        return {"work_id": await plan_service.start(payload.vehicle_id, payload.session_id, payload.lang)}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class Progress(BaseModel):
    steps: dict[str, dict] = Field(default_factory=dict, description="{step_id: {done, value}}")
    checks: dict[str, bool] = Field(default_factory=dict, description="{item_id: ticked} for prep/quality lists")
    stage: Literal["prep", "work", "check", "after"] | None = None
    step: int | None = Field(None, description="id шага, на котором механик: продолженная работа открывается на нём")


@router.get("", summary="Сохранённые работы по проверке (status=active — незавершённые)")
def list_works(vehicle_id: str | None = None, status: Literal["active", "done", "chat"] | None = None):
    works = store.list_works(vehicle_id, status)
    if status == "active":  # unfinished works with a plan of the old rules (repair steps) are not offered to continue
        works = [w for w in works if w["rules"] == plan_service.PLAN_RULES]
    return works


@router.get("/{work_id}", summary="Работа целиком: план диагностики, отметки, чат — чтобы продолжить")
def get_work(work_id: str):
    work = plan_service.get_work(work_id)
    saved = store.load_work(work_id)
    if work is None or saved is None:
        raise HTTPException(status_code=404, detail="Нет такой работы")
    data = saved["data"]
    return {
        "work_id": work_id, "vehicle_id": saved["vehicle_id"], "session_id": saved["session_id"],
        "status": saved["status"], "lang": saved["lang"], "plan": work.plan.snapshot(),
        "progress": data.get("progress") or {}, "diagnosis": data.get("diagnosis"), "chat": data.get("chat") or [],
        "created_at": saved["created_at"], "updated_at": saved["updated_at"],
    }


@router.put("/{work_id}/progress", summary="Сохранить отметки, замеры и этап")
def save_progress(work_id: str, payload: Progress):
    try:
        store.update_work_data(work_id, progress=payload.model_dump())
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/{work_id}/finish", summary="Завершить диагностику: замеры, проверки и рекомендации — в сервисную книжку")
def finish_work(work_id: str):
    try:
        return {"entries": plan_service.finish(work_id)}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{work_id}/rebuild", summary="Собрать план заново (если сборка не удалась)")
async def rebuild_work(work_id: str):
    try:
        await plan_service.rebuild(work_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


@router.get("/{work_id}/stream", summary="План и ход его сборки (SSE): всё с начала, потом вживую")
async def stream_work(work_id: str):
    work = plan_service.get_work(work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="Нет такой работы")
    queue: asyncio.Queue[dict] = asyncio.Queue()
    backlog = list(work.log)
    if work.last_tokens and not any(e["type"] == "done" for e in backlog):
        backlog.append(work.last_tokens)
    work.subscribers.add(queue)

    async def events():
        try:
            for event in backlog:
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
                if event["type"] == "done":
                    return
            while True:
                event = await next_event(queue)
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
                if event["type"] == "done":
                    return
        finally:
            work.subscribers.discard(queue)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
