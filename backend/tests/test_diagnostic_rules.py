import pytest
from pydantic import ValidationError

from app.domain.diagnostic_rules import ensure_diagnosis_allows_repair_advice
from app.schemas.diagnostics import DiagnoseResponse


def make_result(status: str, anomaly_type: str | None):
    return DiagnoseResponse(
        vehicle_id="M333YK47",
        session_id="S-0005",
        status=status,
        anomaly_type=anomaly_type,
        anomaly_title="Тест" if anomaly_type else None,
        anomaly_score=0.76 if status == "anomaly" else None,
        confidence=0.73 if status != "check_failed" else None,
        signal_quality="good" if status != "check_failed" else "bad",
        description="test",
        model_version="mock-v1",
    )


def test_anomaly_allows_ticket_flow():
    ensure_diagnosis_allows_repair_advice(make_result("anomaly", "F08"))


@pytest.mark.parametrize("status", ["normal", "check_failed"])
def test_non_anomaly_is_blocked(status: str):
    with pytest.raises(ValueError):
        ensure_diagnosis_allows_repair_advice(make_result(status, None))
