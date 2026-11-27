from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.diagnostics import DiagnoseResponse


class WorkContext(BaseModel):
    stage: Literal["prep", "work", "check", "after"] | None = None
    step_index: int | None = Field(None, ge=1, description="Номер открытого шага (с 1)")
    step_text: str | None = Field(None, max_length=600)


class ChatRequest(BaseModel):
    vehicle_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    lang: Literal["ru", "uz", "ko"] = "ru"
    conversation_id: str | None = None
    session_id: str | None = Field(None, description="Проверка; по умолчанию последняя проверка машины")
    confirm_warning: bool = Field(
        False, description="Механик прочитал предупреждение о качестве записи и подтверждает заявку"
    )
    context: "WorkContext | None" = Field(None, description="Где механик сейчас в инструкции")
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


LANG_RULE = {
    "ru": "Ответь по-русски.",
    "uz": ("Ответь на узбекском языке латиницей (o‘zbekcha), простыми словами. Цитаты из руководства, названия "
           "документов и обозначения оставь дословно по-русски; числа и единицы — как в руководстве."),
    "ko": ("Ответь на корейском языке (한국어), простыми словами. Цитаты из руководства, названия документов "
           "и обозначения оставь дословно по-русски; числа и единицы — как в руководстве."),
}
UNVERIFIED = {"ru": "⚠ Не подтверждено руководством", "uz": "⚠ Qo‘llanma bilan tasdiqlanmagan",
              "ko": "⚠ 설명서로 확인되지 않음"}


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
    photo_check: dict | None = None  # {shows, matches: yes|no|unclear, reason, engine}
    contradictions: list[dict] = []  # [{note, sides: [{manual_id, manual, pdf_page, quote}], official}]
    steps: list[Step] = []
    cost_usd: float = 0.0
