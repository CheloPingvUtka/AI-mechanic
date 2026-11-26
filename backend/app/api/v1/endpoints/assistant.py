import httpx
from fastapi import APIRouter, HTTPException

from app.integrations.llm_client import LLMError
from app.schemas.assistant import ChatRequest, ChatResponse
from app.services.agent_service import AgentService

router = APIRouter()


@router.post("/chat", response_model=ChatResponse, summary="Сообщение цифровому механику")
async def chat(payload: ChatRequest):
    try:
        return await AgentService().chat(payload)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:  # vehicle catalog or manuals index not configured
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Внешний сервис временно недоступен") from exc
