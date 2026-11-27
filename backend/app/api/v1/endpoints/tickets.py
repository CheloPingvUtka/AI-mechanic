import httpx
from fastapi import APIRouter, HTTPException

from app.repositories import store
from app.schemas.tickets import TicketCreate
from app.services.tickets_service import TicketsService

router = APIRouter()


@router.get("", summary="Заявки, созданные агентом (из базы)")
def list_tickets(vehicle_id: str | None = None):
    return store.tickets(vehicle_id)


@router.post("", status_code=201, summary="Создать заявку на дефектовку")
async def create_ticket(payload: TicketCreate, confirm_warning: bool = False):
    try:
        return await TicketsService().create(payload, warning_confirmed=confirm_warning)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail="Внешний сервис временно недоступен") from exc
