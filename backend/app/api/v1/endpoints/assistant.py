from fastapi import APIRouter, HTTPException

from app.schemas.assistant import ChatRequest
from app.services.agent_service import AgentService

router = APIRouter()


@router.post("/chat", summary="Задать вопрос цифровому механику")
async def chat(payload: ChatRequest):
    try:
        return await AgentService().chat(payload)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
