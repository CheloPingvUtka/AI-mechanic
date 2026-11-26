from fastapi import APIRouter, HTTPException

from app.repositories.vehicle_catalog import JsonVehicleCatalog

router = APIRouter()


@router.get("")
def list_vehicles():
    try:
        return JsonVehicleCatalog().list_vehicles()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/{vehicle_id}")
def get_vehicle(vehicle_id: str):
    try:
        vehicle = JsonVehicleCatalog().get_vehicle(vehicle_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if vehicle is None:
        raise HTTPException(status_code=404, detail="Транспортное средство не найдено")
    return vehicle
