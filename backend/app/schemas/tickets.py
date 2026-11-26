from typing import Literal
from pydantic import BaseModel, Field


class Reference(BaseModel):
    manual: str = Field(min_length=1)
    pdf_page: int = Field(ge=1)


class TicketCreate(BaseModel):
    vehicle_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    anomaly_type: str = Field(pattern=r"^F(0[1-9]|1[0-4])$")
    conclusion: str = Field(min_length=1)
    urgency: Literal["low", "medium", "high"]
    operations: list[str] = Field(min_length=1)
    spare_parts: list[str]
    references: list[Reference] = Field(min_length=1)


class TicketCreated(BaseModel):
    ticket_id: str
    status: Literal["created"]
