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
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Сервис диагностики временно недоступен") from exc
