from app.domain.diagnostic_rules import ensure_diagnosis_allows_repair_advice
from app.integrations.mock_ml_client import MockMLClient
from app.integrations.mock_toir_client import MockToirClient
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

    async def create(self, payload: TicketCreate) -> TicketCreated:
        # Не доверяем диагнозу, присланному браузером: повторно получаем его на backend.
        diagnosis = await self.ml_client.diagnose(
            DiagnoseRequest(vehicle_id=payload.vehicle_id, session_id=payload.session_id)
        )
        ensure_diagnosis_allows_repair_advice(diagnosis)
        if payload.anomaly_type != diagnosis.anomaly_type:
            raise ValueError("Код неисправности в заявке не совпадает с результатом диагностики.")
        return await self.toir_client.create_ticket(payload)
