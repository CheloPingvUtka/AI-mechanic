from fastapi import APIRouter, HTTPException

from app.domain.diagnostic_rules import FLEET_STATES, fleet_state
from app.repositories.vehicle_catalog import JsonVehicleCatalog

router = APIRouter()


@router.get("", summary="Состояние парка: машины по последней проверке, сначала самые рискованные")
def fleet():
    try:
        vehicles = JsonVehicleCatalog().list_vehicles()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    rows = []
    for v in vehicles:
        last = v.sessions[-1]
        state = fleet_state(last.status, last.anomaly_type, last.anomaly_score, last.confidence, v.fuel)
        rows.append({**v.model_dump(mode="json"), **state})
    rank = {s: i for i, s in enumerate(FLEET_STATES)}
    rows.sort(key=lambda r: (rank[r["state"]], -(r["sessions"][-1]["anomaly_score"] or 0)))
    return rows
