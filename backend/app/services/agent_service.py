from app.repositories.vehicle_catalog import JsonVehicleCatalog
from app.schemas.assistant import ChatRequest, ChatResponse
from app.services.rag_service import RAGService


class AgentService:
    """Application-level agent coordinator. Tool selection will be added behind this boundary."""

    def __init__(
        self,
        catalog: JsonVehicleCatalog | None = None,
        rag: RAGService | None = None,
    ) -> None:
        self.catalog = catalog or JsonVehicleCatalog()
        self.rag = rag or RAGService()

    async def chat(self, payload: ChatRequest) -> ChatResponse:
        vehicle = self.catalog.get_vehicle(payload.vehicle_id)
        if vehicle is None:
            raise LookupError(f"Транспортное средство {payload.vehicle_id} не найдено.")

        answer, plan, sources = await self.rag.answer(
            engine_model=vehicle.engine_model,
            question=payload.message,
        )
        return ChatResponse(
            answer=answer,
            repair_plan=plan,
            sources=sources,
            needs_human_confirmation=True,
            knowledge_found=bool(sources),
        )
