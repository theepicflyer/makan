from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    data_dir: Path = REPO_ROOT / "data" / "runtime"
    reference_dir: Path = REPO_ROOT / "data" / "reference"
    static_dir: Path = REPO_ROOT / "web" / "build"

    # Public URL the app is served on, e.g. https://makan.example.com
    public_url: str = "http://localhost:8000"
    session_secret: str = "dev-only-insecure-secret"

    # Pocket ID (or any OIDC provider). Unset = no OIDC; only dev login works.
    oidc_config_url: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    # Optional allowlist on top of Pocket ID's group restriction.
    allowed_emails: str = ""

    # Local development only: shows a user picker instead of OIDC.
    dev_login: bool = False
    # MCP without OAuth acts as this user (local development and tests only).
    mcp_dev_user: str | None = None

    timezone: str = "Asia/Singapore"
    # Before this hour, "today" still means the previous day.
    day_rollover_hour: int = 4

    anthropic_api_key: str | None = None
    agent_model: str = "claude-haiku-5-5"
    agent_effort: str = "low"
    agent_max_tokens: int = 16000

    @property
    def db_path(self) -> Path:
        return self.data_dir / "makan.db"

    @property
    def photo_dir(self) -> Path:
        return self.data_dir / "photos"

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    def now(self) -> datetime:
        return datetime.now(self.tz)

    def today(self) -> date:
        return (self.now() - timedelta(hours=self.day_rollover_hour)).date()

    @property
    def allowed_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
