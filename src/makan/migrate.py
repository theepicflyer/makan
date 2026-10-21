from pathlib import Path

from alembic import command
from alembic.config import Config

from makan.db import get_engine

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    return cfg


def upgrade() -> None:
    with get_engine().begin() as connection:
        cfg = alembic_config()
        cfg.attributes["connection"] = connection
        command.upgrade(cfg, "head")


def revision(message: str) -> None:
    command.revision(alembic_config(), message=message, autogenerate=True)
