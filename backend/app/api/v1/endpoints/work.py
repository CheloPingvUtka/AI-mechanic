import asyncio
import json
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

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


@router.get("/{work_id}", summary="Текущий рабочий план")
def get_work(work_id: str):
    work = plan_service.WORKS.get(work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="Нет такой работы")
    return work.plan.snapshot()


@router.get("/{work_id}/stream", summary="План и ход его сборки (SSE): всё с начала, потом вживую")
async def stream_work(work_id: str):
    work = plan_service.WORKS.get(work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="Нет такой работы")
    queue: asyncio.Queue[dict] = asyncio.Queue()
    backlog = list(work.log)
    work.subscribers.add(queue)

    async def events():
        try:
            for event in backlog:
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
                if event["type"] == "done":
                    return
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
                if event["type"] == "done":
                    return
        finally:
            work.subscribers.discard(queue)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
