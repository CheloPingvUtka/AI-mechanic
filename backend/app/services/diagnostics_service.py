from app.integrations.mock_ml_client import MockMLClient
from app.schemas.diagnostics import DiagnoseRequest, DiagnoseResponse


class DiagnosticsService:
    def __init__(self, ml_client: MockMLClient | None = None) -> None:
        self.ml_client = ml_client or MockMLClient()

    async def run(self, payload: DiagnoseRequest) -> DiagnoseResponse:
        return await self.ml_client.diagnose(payload)
