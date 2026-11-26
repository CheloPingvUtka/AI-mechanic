from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    vehicle_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    session_id: str | None = None


class SourceReference(BaseModel):
    manual: str
    pdf_page: int
    excerpt: str | None = None


class RepairPlan(BaseModel):
    observations: list[str] = []
    possible_causes: list[str] = []
    checks: list[str] = []
    repair_actions: list[str] = []
    urgency: str | None = None


class ChatResponse(BaseModel):
    answer: str
    repair_plan: RepairPlan | None = None
    sources: list[SourceReference] = []
    needs_human_confirmation: bool = True
    knowledge_found: bool
