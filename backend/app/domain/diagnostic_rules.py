from app.schemas.diagnostics import DiagnoseResponse


def ensure_diagnosis_allows_repair_advice(result: DiagnoseResponse) -> None:
    """Block engine conclusions when the acoustic check failed or found no anomaly."""
    if result.status == "check_failed":
        raise ValueError("Проверка не состоялась: повторите запись. Вывод о двигателе не формируется.")
    if result.status == "normal":
        raise ValueError("Отклонение не обнаружено. Заявку по неисправности создавать нельзя.")
    if result.status == "anomaly" and not result.anomaly_type:
        raise ValueError("В ответе диагностики отсутствует код предполагаемой неисправности.")
