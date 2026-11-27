from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Digital Mechanic API"
    app_env: str = "development"
    api_v1_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:5173"
    mock_ml_base_url: str = "http://127.0.0.1:8001"
    mock_toir_base_url: str = "http://127.0.0.1:8002"
    http_timeout_seconds: float = 10.0
    vehicle_catalog_path: str = "../private-neurodvs-mock/data/vehicles.json"
    knowledge_base_path: str = "../private-knowledge"
    llm_api_key: str = ""
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str = "deepseek/deepseek-v4.1-flash"
    llm_timeout_seconds: float = 90.0
    llm_max_tokens: int = 4000  # one call; caps cost and latency if the model runs away
    tessdata_dir: str = ""  # folder with rus.traineddata, if not in the system tessdata

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
