import pytest

from app.core.config import settings
from app.repositories import store


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    """Every test gets its own empty database and photo folder."""
    monkeypatch.setattr(settings, "data_dir", str(tmp_path / "data"))
    store.reset()
    yield
    store.reset()
