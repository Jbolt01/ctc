## Cornell Trading Competition Platform Backend

### Backend Architecture
   * API Layer (FastAPI): Exposes REST endpoints for all operations like placing orders, fetching market data, and managing administrative tasks. It handles incoming HTTP requests and validation.
   * Database (PostgreSQL): A relational database used to persist all data, including users, teams, orders, trades, and positions.
   * Data Access Layer (SQLAlchemy): The application uses the SQLAlchemy ORM to interact with the PostgreSQL database. All database tables are defined as Python classes (models) in src/db/models.py.
   * Business Logic (`src/core`): This layer contains the core rules of the application, such as the OrderService which handles the logic for creating and validating orders.
   * Matching Engine (`src/exchange`): This is the heart of the trading system. It's an in-memory component that manages order books for each financial symbol. When a new order is placed, the ExchangeManager uses a MatchingEngine to match it against existing open orders, creating trades and updating positions.
   * Database Migrations (Alembic): The database schema is managed through Alembic, allowing for version-controlled, incremental updates.
   * Containerization (Docker): The entire backend is packaged into a Docker container for consistent deployment. The entrypoint.sh script ensures that database migrations are applied before the main application starts.
   * API Layer (FastAPI): Exposes REST endpoints for all operations like placing orders, fetching market data, and managing administrative tasks. It handles incoming HTTP requests and validation.
   * Database (PostgreSQL): A relational database used to persist all data, including users, teams, orders, trades, and positions.

### Directory Structure
#### `/`
Root directory with main backend config files.
- `alembic.ini`: Configuration file for Alembic (database migration tool).
- `pyproject.toml`: Project metadata and dependencies managed by `uv`.
- `Dockerfile`: Instructions for building the backend Docker image.
- `entrypoint.sh`: Script executed when the Docker container starts, runs migrations and starts the application.
- `README.md`: This README file.

#### `/alembic`
This directory contains the database migration scripts managed by Alembic.
- `env.py`: Configures Alembic to run migrations against the database. It reads the database URL from environment variables.
- `/versions`: Contains the individual migration files, each representing a change to the database schema.

#### `/src`
This is the main source code directory for the application.
- `__init__.py`: Makes the `src` directory a Python package.
- `/app`: Contains the FastAPI application.
  - `main.py`: The primary application file. It defines all API endpoints for trading (orders, positions, trades), market data, and administration.
  - `config.py`: Defines application settings, loaded from environment variables using Pydantic.
  - `deps.py`: Defines FastAPI dependencies, such as `require_api_key` for validating API keys.
  - `startup.py`: Contains logic that runs on application startup, including seeding the database with initial data.
- `/core`: Contains the core business logic.
  - `orders.py`: `OrderService` class responsible for the business logic of placing an order.
- `/db`: Contains database-related modules.
  - `models.py`: Defines all SQLAlchemy ORM models, representing the database tables (e.g., `User`, `Team`, `Order`, `Trade`).
  - `session.py`: Manages the database session, providing a `get_db_session` dependency for FastAPI.
- `/exchange`: Contains the trading exchange and matching engine logic.
  - `engine.py`: A simple in-memory matching engine (`MatchingEngine`) that handles bid/ask matching.
  - `manager.py`: The `ExchangeManager` which manages order books for different symbols and orchestrates the matching process.

#### `/tests`
Contains automated tests for the backend.
- `conftest.py`: Pytest configuration file, used here to modify the Python path for imports.
- `test_health.py`: A simple test to ensure the `/health` endpoint is working correctly.
