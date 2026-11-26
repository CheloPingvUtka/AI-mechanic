import httpx

from app.core.config import settings
from app.schemas.diagnostics import DiagnoseRequest, DiagnoseResponse


class MockMLClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.mock_ml_base_url).rstrip("/")

    async def diagnose(self, payload: DiagnoseRequest) -> DiagnoseResponse:
        async with httpx.AsyncClient(timeout=settings.http_timeout_seconds) as client:
            response = await client.post(
                f"{self.base_url}/diagnose", json=payload.model_dump()
            )
            response.raise_for_status()
            return DiagnoseResponse.model_validate(response.json())
