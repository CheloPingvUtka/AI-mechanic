from app.domain.diagnostic_rules import ticket_block_reason
from app.integrations.mock_ml_client import MockMLClient
from app.integrations.mock_toir_client import MockToirClient
from app.repositories.vehicle_catalog import JsonVehicleCatalog
from app.schemas.diagnostics import DiagnoseRequest
from app.schemas.tickets import TicketCreate, TicketCreated


class TicketsService:
    def __init__(
        self,
        toir_client: MockToirClient | None = None,
        ml_client: MockMLClient | None = None,
    ) -> None:
        self.toir_client = toir_client or MockToirClient()
        self.ml_client = ml_client or MockMLClient()

    async def create(self, payload: TicketCreate, warning_confirmed: bool = False) -> TicketCreated:
        # Не доверяем диагнозу, присланному браузером: повторно получаем его на backend.
        diagnosis = await self.ml_client.diagnose(
            DiagnoseRequest(vehicle_id=payload.vehicle_id, session_id=payload.session_id)
        )
        vehicle = JsonVehicleCatalog().get_vehicle(payload.vehicle_id)
        if reason := ticket_block_reason(diagnosis, warning_confirmed, vehicle.fuel if vehicle else None):
            raise ValueError(reason)
        if payload.anomaly_type != diagnosis.anomaly_type:
            raise ValueError("Код неисправности в заявке не совпадает с результатом диагностики.")
        return await self.toir_client.create_ticket(payload)
