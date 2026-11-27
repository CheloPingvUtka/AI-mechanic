import asyncio
import json
import logging

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.integrations.llm_client import LLMError
from app.schemas.assistant import ChatRequest, ChatResponse
from app.services.agent_service import AgentService

router = APIRouter()
log = logging.getLogger("uvicorn.error")
PING_SECONDS = 5  # the UI shows «нет связи» when nothing, not even a ping, came for a while


async def next_event(queue: asyncio.Queue) -> dict:
    """The next event, or a ping when the agent has been quiet (e.g. a long model call)."""
    try:
        return await asyncio.wait_for(queue.get(), PING_SECONDS)
    except TimeoutError:
        return {"type": "ping"}


def error_status(exc: Exception) -> tuple[int, str] | None:
    if isinstance(exc, LookupError):
        return 404, str(exc)
    if isinstance(exc, FileNotFoundError):  # vehicle catalog or manuals index not configured
        return 503, str(exc)
    if isinstance(exc, LLMError):
        return 502, str(exc)
    if isinstance(exc, httpx.RequestError):
        return 503, "Внешний сервис временно недоступен"
    return None


@router.post("/chat", response_model=ChatResponse, summary="Сообщение цифровому механику")
async def chat(payload: ChatRequest):
    try:
        return await AgentService().chat(payload)
    except Exception as exc:
        if known := error_status(exc):
            raise HTTPException(status_code=known[0], detail=known[1]) from exc
        raise


@router.post("/chat/stream", summary="То же, но с ходом работы агента (Server-Sent Events)")
async def chat_stream(payload: ChatRequest):
    """Events: thinking | tool | tool_result | checking | fixing, then done (with the ChatResponse) or error."""
    queue: asyncio.Queue[dict] = asyncio.Queue()

    async def run():
        try:
            response = await AgentService().chat(payload, emit=queue.put_nowait)
            queue.put_nowait({"type": "done", "response": response.model_dump(mode="json")})
        except Exception as exc:
            known = error_status(exc)
            if known is None:
                log.exception("agent failed")
            status, detail = known or (500, "Внутренняя ошибка агента")
            queue.put_nowait({"type": "error", "status": status, "detail": detail})

    # Keep a reference so the task is not garbage-collected; it finishes even if the client leaves,
    # so a ticket is never left half-created.
    task = asyncio.create_task(run())

    async def events():
        while True:
            event = await next_event(queue)
            yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
            if event["type"] in ("done", "error"):
                await task
                return

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
