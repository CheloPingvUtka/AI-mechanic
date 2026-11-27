import pytest

from app.domain.diagnostic_rules import ticket_block_reason, urgency
from app.schemas.diagnostics import DiagnoseResponse


def make_result(status="anomaly", anomaly_type="F08", confidence=0.73, quality="good", score=0.76):
    failed = status == "check_failed"
    return DiagnoseResponse(
        vehicle_id="M333YK47",
        session_id="S-0005",
        status=status,
        anomaly_type=anomaly_type if status == "anomaly" else None,
        anomaly_title="Тест" if status == "anomaly" else None,
        anomaly_score=None if failed else score,
        confidence=None if failed else confidence,
        signal_quality="bad" if failed else quality,
        description="test",
        model_version="mock-v1",
    )


def test_good_anomaly_allows_ticket():
    assert ticket_block_reason(make_result(), warning_confirmed=False, fuel="дизель") is None


@pytest.mark.parametrize(
    "result",
    [
        make_result("normal"),
        make_result("check_failed"),
        make_result(quality="bad"),
        make_result(confidence=0.49),
        make_result(quality="warning"),
    ],
)
def test_ticket_blocked(result):
    assert ticket_block_reason(result, warning_confirmed=False)


def test_warning_needs_explicit_confirmation():
    assert ticket_block_reason(make_result(quality="warning"), warning_confirmed=True) is None
    # confirmation never overrides a low confidence
    assert ticket_block_reason(make_result(quality="warning", confidence=0.4), warning_confirmed=True)


@pytest.mark.parametrize("code,fuel", [("F12", "дизель"), ("F13", "дизель"), ("F08", "бензин")])
def test_fault_impossible_for_fuel_blocks_ticket(code, fuel):
    assert "топливе" in ticket_block_reason(make_result(anomaly_type=code), True, fuel)


def test_urgency_base_and_bounded_score_adjustment():
    assert urgency("F08", 0.70) == "medium"
    assert urgency("F08", 0.90) == "high"
    assert urgency("F08", 0.55) == "low"
    assert urgency("F02", 0.99) == "high"  # already at the top
    assert urgency("F05", 0.50) == "low"  # already at the bottom
    assert urgency("F05", 0.50, operation_banned=True) == "high"


def test_fleet_state():
    from app.domain.diagnostic_rules import fleet_state

    assert fleet_state("normal", None, 0.1, 0.9, "дизель")["state"] == "normal"
    assert fleet_state("check_failed", None, None, None, "дизель")["state"] == "attention"
    assert fleet_state("anomaly", "F02", 0.8, 0.45, "дизель")["urgency"] is None  # low confidence: recheck
    assert fleet_state("anomaly", "F12", 0.9, 0.9, "дизель")["state"] == "attention"  # impossible on diesel
    assert fleet_state("anomaly", "F02", 0.8, 0.9, "дизель")["state"] == "quarantine"
    assert fleet_state("anomaly", "F05", 0.7, 0.9, "дизель")["state"] == "attention"
