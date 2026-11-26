import httpx
from fastapi import APIRouter, HTTPException

from app.schemas.diagnostics import DiagnoseRequest
from app.services.diagnostics_service import DiagnosticsService

router = APIRouter()


@router.post("", summary="Получить результат акустической диагностики")
async def run_diagnostics(payload: DiagnoseRequest):
    try:
        return await DiagnosticsService().run(payload)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Сервис диагностики временно недоступен") from exc
