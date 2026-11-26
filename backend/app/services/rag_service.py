from app.schemas.assistant import RepairPlan, SourceReference


class RAGService:
    """RAG boundary. Implement PDF ingestion/retrieval here; never fabricate citations."""

    async def answer(
        self, *, engine_model: str, question: str
    ) -> tuple[str, RepairPlan | None, list[SourceReference]]:
        # Deliberately fail closed until a real document index and retriever are configured.
        return (
            "База технической документации пока не подключена. "
            "Не могу подтвердить процедуру или норматив по руководству.",
            None,
            [],
        )
