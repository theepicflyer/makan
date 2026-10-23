from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import Engine

from makan.db import get_engine

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def alembic_config() -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    return cfg


def upgrade_engine(engine: Engine) -> None:
    # Batch migrations rebuild tables, and SQLite won't drop a table that other rows still
    # reference while foreign keys are on. The pragma is a no-op inside a transaction.
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        try:
            with connection.begin():
                cfg = alembic_config()
                cfg.attributes["connection"] = connection
                command.upgrade(cfg, "head")
                broken = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
                if broken:
                    raise RuntimeError(f"migration broke foreign keys: {broken}")
        finally:
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            connection.commit()


def upgrade() -> None:
    upgrade_engine(get_engine())


def revision(message: str) -> None:
    command.revision(alembic_config(), message=message, autogenerate=True)
