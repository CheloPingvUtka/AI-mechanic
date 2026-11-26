import httpx

from app.core.config import settings
from app.schemas.tickets import TicketCreate, TicketCreated


class MockToirClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.mock_toir_base_url).rstrip("/")

    async def create_ticket(self, payload: TicketCreate) -> TicketCreated:
        async with httpx.AsyncClient(timeout=settings.http_timeout_seconds) as client:
            response = await client.post(
                f"{self.base_url}/tickets", json=payload.model_dump()
            )
            response.raise_for_status()
            return TicketCreated.model_validate(response.json())
