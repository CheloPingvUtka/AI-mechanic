from pydantic import BaseModel, Field, field_validator

from app.schemas.diagnostics import DiagnoseResponse


class ChatRequest(BaseModel):
    vehicle_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    conversation_id: str | None = None
    session_id: str | None = Field(None, description="Проверка; по умолчанию последняя проверка машины")
    confirm_warning: bool = Field(
        False, description="Механик прочитал предупреждение о качестве записи и подтверждает заявку"
    )
    images: list[str] = Field(
        [], max_length=4, description="Фото механика: data:image/jpeg;base64,… (сжатые на устройстве)"
    )

    @field_validator("images")
    @classmethod
    def images_are_small_data_urls(cls, images: list[str]) -> list[str]:
        for url in images:
            if not url.startswith(("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")):
                raise ValueError("фото должно быть data URL jpeg/png/webp")
            if len(url) > 3_000_000:
                raise ValueError("фото больше ~2 МБ: уменьшите перед отправкой")
        return images


class SourceReference(BaseModel):
    manual_id: str
    manual: str
    pdf_page: int
    excerpt: str
    ocr: bool = False
    figures: int = 0  # cut-out figures on that page: /manuals/{manual_id}/pages/{pdf_page}/figures/{i}.png


class Step(BaseModel):
    name: str  # llm:<tools called> | llm:answer | llm:fix | the tool name itself
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    seconds: float = 0.0


class ChatResponse(BaseModel):
    conversation_id: str
    answer: str
    sources: list[SourceReference] = []
    diagnosis: DiagnoseResponse | None = None
    ticket: dict | None = None
    steps: list[Step] = []
    cost_usd: float = 0.0
