from __future__ import annotations

import os
import sys
from logging.config import fileConfig

from dotenv import load_dotenv
from sqlalchemy import create_engine

from alembic import context

# Load .env file from project root
dotenv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
load_dotenv(dotenv_path=dotenv_path)

# Ensure project root is importable so 'src' is found when running Alembic
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from src.db.models import Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Derive URL from env var and ensure synchronous driver for Alembic
env_db_url = os.getenv("DATABASE_URL")
if env_db_url:
    if env_db_url.startswith("postgresql+asyncpg"):
        env_db_url = env_db_url.replace("postgresql+asyncpg", "postgresql+psycopg")
    config.set_main_option("sqlalchemy_url", env_db_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy_url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    db_url = config.get_main_option("sqlalchemy_url")
    if not db_url:
        raise ValueError("A database URL must be provided via DATABASE_URL env var.")

    connectable = create_engine(db_url)

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

