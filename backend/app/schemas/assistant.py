from pydantic import BaseModel, Field

from app.schemas.diagnostics import DiagnoseResponse


class ChatRequest(BaseModel):
    vehicle_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    conversation_id: str | None = None
    session_id: str | None = Field(None, description="Проверка; по умолчанию последняя проверка машины")
    confirm_warning: bool = Field(
        False, description="Механик прочитал предупреждение о качестве записи и подтверждает заявку"
    )


class SourceReference(BaseModel):
    manual: str
    pdf_page: int
    excerpt: str
    ocr: bool = False


class Step(BaseModel):
    name: str  # "llm" or the tool name
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0


class ChatResponse(BaseModel):
    conversation_id: str
    answer: str
    sources: list[SourceReference] = []
    diagnosis: DiagnoseResponse | None = None
    ticket: dict | None = None
    steps: list[Step] = []
    cost_usd: float = 0.0
