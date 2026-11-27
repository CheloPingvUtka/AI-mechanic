import httpx
from fastapi import APIRouter, HTTPException

from app.domain.diagnostic_rules import assess
from app.repositories.vehicle_catalog import JsonVehicleCatalog
from app.schemas.diagnostics import DiagnoseRequest
from app.services.diagnostics_service import DiagnosticsService

router = APIRouter()


@router.post("", summary="Результат акустической проверки + приоритет и допустимость заявки")
async def run_diagnostics(payload: DiagnoseRequest):
    try:
        d = await DiagnosticsService().run(payload)
        vehicle = JsonVehicleCatalog().get_vehicle(payload.vehicle_id)
        return {**d.model_dump(), **assess(d, vehicle.fuel if vehicle else None)}
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"У {payload.vehicle_id} нет проверки {payload.session_id}") from exc
        raise HTTPException(status_code=502, detail=f"Сервис диагностики ответил ошибкой {exc.response.status_code}") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Сервис диагностики временно недоступен") from exc
