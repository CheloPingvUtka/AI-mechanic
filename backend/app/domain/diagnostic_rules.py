"""Hard rules of the product. They hold no matter what the LLM says.

Agreed with the customer (Q&A 26.11.2026):
- signal_quality=bad / check_failed: no engine conclusions and no ticket, offer a new recording;
- confidence below CONFIDENCE_MIN: re-check, no ticket (threshold shown to the mechanic);
- signal_quality=warning: always warn; a ticket only after the mechanic explicitly confirms.
- a ticket needs an instruction for the node the fault type points to, in this engine's manual;
  a fault type that cannot exist on this fuel type has none by definition;
- "operation forbidden" only when the engine manual says so explicitly (then priority is high).
"""
import re

from app.schemas.diagnostics import DiagnoseResponse

CONFIDENCE_MIN = 0.50

URGENCY_LEVELS = ("low", "medium", "high")
URGENCY_MEANING = {
    "high": "машина ставится на дефектовку до выпуска в рейс",
    "medium": "дефектовка на ближайшем ТО, машина работает под наблюдением",
    "low": "машина работает, узел проверяется на следующей проверке",
}
# Base criticality of the fault type. High: failure can destroy the engine quickly
# (oil starvation, overheating, timing chain) or affects brakes/steering (F10).
BASE_URGENCY = {
    "F01": "medium",  # клапанный механизм
    "F02": "high",  # низкое давление масла
    "F03": "high",  # перегрев, ОЖ в масле
    "F04": "medium",  # ремённый привод агрегатов
    "F05": "low",  # генератор
    "F06": "medium",  # сцепление
    "F07": "medium",  # коробка передач
    "F08": "medium",  # дизельная топливоподача
    "F09": "medium",  # турбокомпрессор
    "F10": "high",  # компрессор пневмотормозов, насос ГУР
    "F11": "low",  # рециркуляция ОГ
    "F12": "medium",  # зажигание
    "F13": "medium",  # подача бензина
    "F14": "high",  # цепь ГРМ, гидронатяжитель
}
SCORE_UP, SCORE_DOWN = 0.85, 0.60
# Fault types that exist only on one fuel type (ignition and petrol supply vs diesel injection).
FUEL_ONLY = {"F08": "дизель", "F12": "бензин", "F13": "бензин"}
OPERATION_BAN = re.compile(r"запрещ|не допуска|недопуст|не эксплуатир|не следует эксплуатир", re.IGNORECASE)


def urgency(anomaly_type: str, anomaly_score: float, operation_banned: bool = False) -> str:
    """Base level of the fault type, moved at most one step by anomaly_score.
    A manual that explicitly forbids operation makes it high."""
    if operation_banned:
        return "high"
    i = URGENCY_LEVELS.index(BASE_URGENCY[anomaly_type])
    if anomaly_score >= SCORE_UP:
        i += 1
    elif anomaly_score < SCORE_DOWN:
        i -= 1
    return URGENCY_LEVELS[max(0, min(i, len(URGENCY_LEVELS) - 1))]


def fault_mismatch(anomaly_type: str | None, fuel: str | None) -> str | None:
    need = FUEL_ONLY.get(anomaly_type or "")
    if need and fuel and fuel != need:
        return (
            f"Тип неисправности {anomaly_type} бывает только у двигателей на топливе «{need}», "
            f"а у этой машины «{fuel}». В руководстве на этот двигатель нет инструкции по такому узлу, "
            "поэтому заявка не создаётся. Вероятна ошибка классификации: рекомендуется повторная запись "
            "и дефектовка по порядку автопарка."
        )
    return None


def block_code(d: DiagnoseResponse, warning_confirmed: bool, fuel: str | None = None) -> str | None:
    """Machine-readable reason a ticket is blocked (the UI translates it), or None if it may be created."""
    if d.status == "check_failed" or d.signal_quality == "bad":
        return "bad_recording"
    if d.status == "normal":
        return "no_anomaly"
    if not d.anomaly_type or d.anomaly_score is None:
        return "no_fault_code"
    if d.confidence is None or d.confidence < CONFIDENCE_MIN:
        return "low_confidence"
    if fault_mismatch(d.anomaly_type, fuel):
        return "fuel_mismatch"
    if d.signal_quality == "warning" and not warning_confirmed:
        return "needs_confirmation"
    return None


def ticket_block_reason(d: DiagnoseResponse, warning_confirmed: bool, fuel: str | None = None) -> str | None:
    """Why a defect ticket must not be created for this check (Russian, for the agent), or None."""
    code = block_code(d, warning_confirmed, fuel)
    return {
        None: None,
        "bad_recording": "Запись непригодна: вывод о двигателе и заявка невозможны. Повторите запись.",
        "no_anomaly": "Отклонение не обнаружено: заявку по неисправности создавать не на что.",
        "no_fault_code": "В ответе диагностики нет кода или оценки неисправности.",
        "low_confidence": f"Уверенность модели {d.confidence} ниже порога {CONFIDENCE_MIN:.2f}: "
                          "нужна повторная проверка, заявка не создаётся.",
        "fuel_mismatch": fault_mismatch(d.anomaly_type, fuel),
        "needs_confirmation": "Запись с помехами (warning): заявку можно создать только после того, как механик "
                              "прочитает предупреждение и нажмёт кнопку «Подтверждаю, создать заявку».",
    }[code]


FLEET_STATES = ("quarantine", "attention", "normal")


def fleet_state(status: str, anomaly_type: str | None, anomaly_score: float | None,
                confidence: float | None, fuel: str | None) -> dict:
    """Vehicle state for the chief mechanic, from its latest check, by the same rules as tickets."""
    if status == "normal":
        return {"state": "normal", "urgency": None, "code": "normal", "reason": "Последняя проверка: норма"}
    if status == "check_failed":
        return {"state": "attention", "urgency": None, "code": "bad_recording",
                "reason": "Запись отбракована: повторить проверку"}
    if confidence is None or confidence < CONFIDENCE_MIN:
        return {"state": "attention", "urgency": None, "code": "low_confidence",
                "reason": f"Уверенность ниже {CONFIDENCE_MIN:.2f}: повторить проверку"}
    if fault_mismatch(anomaly_type, fuel):
        return {"state": "attention", "urgency": None, "code": "fuel_mismatch",
                "reason": "Тип неисправности не подходит к двигателю: повторить проверку"}
    level = urgency(anomaly_type, anomaly_score)
    return {"state": "quarantine" if level == "high" else "attention", "urgency": level,
            "code": f"urgency_{level}", "reason": URGENCY_MEANING[level]}


def assess(d: DiagnoseResponse, fuel: str | None, warning_confirmed: bool = False) -> dict:
    """What the product concludes from a check: priority, and whether/why a ticket is blocked."""
    out = {
        "confidence_threshold": CONFIDENCE_MIN,
        "ticket_blocked_reason": ticket_block_reason(d, warning_confirmed, fuel),
        "block_code": block_code(d, warning_confirmed, fuel),
        "needs_warning_confirmation": (
            not warning_confirmed
            and ticket_block_reason(d, False, fuel) is not None
            and ticket_block_reason(d, True, fuel) is None
        ),
        "urgency": None,
    }
    if d.status == "anomaly" and d.anomaly_type and d.anomaly_score is not None:
        level = urgency(d.anomaly_type, d.anomaly_score)
        out["urgency"] = {"level": level, "meaning": URGENCY_MEANING[level]}
    return out
