import json
from pathlib import Path

from app.core.config import settings
from app.schemas.vehicles import Vehicle


class JsonVehicleCatalog:
    """Reads the catalog from an external private folder; no dataset is stored in this repo."""

    def __init__(self, file_path: str | None = None) -> None:
        self.file_path = Path(file_path or settings.vehicle_catalog_path).expanduser()

    def list_vehicles(self) -> list[Vehicle]:
        if not self.file_path.is_file():
            raise FileNotFoundError(
                f"Vehicle catalog not found: {self.file_path}. "
                "Set VEHICLE_CATALOG_PATH to the private mock repository's data/vehicles.json."
            )
        payload = json.loads(self.file_path.read_text(encoding="utf-8"))
        return [Vehicle.model_validate(item) for item in payload["vehicles"]]

    def get_vehicle(self, vehicle_id: str) -> Vehicle | None:
        return next((v for v in self.list_vehicles() if v.vehicle_id == vehicle_id), None)
