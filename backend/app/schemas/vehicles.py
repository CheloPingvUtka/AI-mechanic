from datetime import datetime

from pydantic import BaseModel


class DiagnosticSession(BaseModel):
    session_id: str
    checked_at: datetime
    status: str
    anomaly_type: str | None = None
    anomaly_title: str | None = None
    anomaly_score: float | None = None
    confidence: float | None = None
    signal_quality: str
    description: str
    model_version: str


class Vehicle(BaseModel):
    vehicle_id: str
    garage_no: str
    make: str
    model: str | None = None
    vehicle_type: str
    engine_model: str
    fuel: str
    sessions: list[DiagnosticSession]
