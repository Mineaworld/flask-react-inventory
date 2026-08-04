# Inventory Management System

https://github.com/user-attachments/assets/e42c5743-bbf0-406b-b4b2-4fa045b14910

A Flask and database course project for managing products, stock, purchases, and sales. Flask provides the API, SQLAlchemy saves data in XAMPP MariaDB, and React provides the user interface.

This machine uses the MariaDB 10.4 server included with XAMPP on port `3307`. The project uses SQLAlchemy's `mysql+mysqldb` connection and the same `mysqlclient` driver installed in the class reference project.

## Architecture

```text
React + TanStack Query
        |
        | /api/v1 JSON, session cookie, CSRF token
        v
Flask routes -> role checks -> service transactions
        |
        v
SQLAlchemy + Alembic -> mysqlclient -> XAMPP MariaDB 10.4
```

- `backend/inventory/api.py` defines HTTP resources and response shapes.
- `backend/inventory/services.py` owns validation, document workflows, stock locking, and transactions.
- `backend/inventory/models.py` defines the typed domain and append-only movement ledger.
- `backend/migrations/` is the authoritative MariaDB schema history.
- `frontend/src/lib/api.ts` handles JSON, cookies, and CSRF; feature folders use TanStack Query to load and refresh server state.
- In development, Vite proxies `/api` to Flask. After `npm run build`, Flask serves `frontend/dist`, including React client routes such as `/catalog`.

## Features And Roles

| Capability | Admin | Manager | Staff |
| --- | :---: | :---: | :---: |
| Operational dashboard and low-stock list | Yes | Yes | Own-safe view |
| View products and on-hand stock | Yes | Yes | Yes |
| Manage categories, products, suppliers, customers | Yes | Yes | No |
| View cost values and stock movement history | Yes | Yes | No |
| Create and receive purchases | Yes | Yes | No |
| Create, edit, and cancel any sale draft | Yes | Yes | Own drafts only |
| Complete a sale and deduct stock | Yes | Yes | No |
| Make stock adjustments | Yes | Yes | No |

Purchases and sales lock their entered currency, exchange rate, document totals, and USD totals. Receiving a purchase or completing a sale updates `stock_balances` and appends `stock_movements` in one transaction. Product quantity is never edited directly, and insufficient stock rejects the entire sale.

## Windows/XAMPP Quickstart

Prerequisites:

- Python 3.12
- Node.js 20 or newer
- XAMPP with MariaDB/MySQL running on port `3307`

All commands below start in the repository root in PowerShell.

### 1. Prepare the databases

Start MySQL in the XAMPP Control Panel. The SQL script is non-destructive, so it is safe if `InventorySystem` already exists:

```powershell
Get-Content .\backend\scripts\create_databases.sql |
  & "C:\xampp\mysql\bin\mysql.exe" --host=127.0.0.1 --port=3307 --user=root
```

If the XAMPP root account has a password, add `--password` and enter it when prompted. The application database is `InventorySystem`; the guarded integration suite uses only `inventorysystem_test`.

### 2. Configure and migrate Flask

```powershell
Set-Location .\backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
py -3.12 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Paste the generated value into `backend/.env` as `SECRET_KEY`. The default example assumes XAMPP root has no password:

```dotenv
DATABASE_URL=mysql+mysqldb://root@127.0.0.1:3307/inventorysystem?charset=utf8mb4
TEST_DATABASE_URL=mysql+mysqldb://root@127.0.0.1:3307/inventorysystem_test?charset=utf8mb4
FLASK_ENV=development
RATELIMIT_STORAGE_URI=memory://
```

Then migrate and create the repeatable demo data:

```powershell
.\.venv\Scripts\python.exe -m flask --app inventory db upgrade
$DemoPassword = Read-Host "Choose the password for all three demo accounts"
.\.venv\Scripts\python.exe -m flask --app inventory seed-demo --password $DemoPassword
```

The seed command is idempotent and creates `demo-admin`, `demo-manager`, and `demo-staff`. Their password is exactly the value supplied to `--password`; it is not printed or stored in documentation.

### 3. Run separate development servers

Backend terminal, from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m flask --app inventory run --debug --host 127.0.0.1 --port 5000
```

Frontend terminal, from the repository root:

```powershell
Set-Location .\frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`. Keep both terminals running. Vite sends `/api` requests to `http://127.0.0.1:5000`.

## Serve The React Production Build From Flask

Build the frontend once:

```powershell
Set-Location .\frontend
npm ci
npm run build
Set-Location ..\backend
.\.venv\Scripts\python.exe -m flask --app inventory run --host 127.0.0.1 --port 5000
```

Open `http://127.0.0.1:5000`. Flask serves real files from `frontend/dist` and sends `index.html` for React client routes. `/api/v1/*` always keeps API precedence and unknown API routes return JSON. If the build is absent, `/` returns a helpful JSON build instruction while `/api/v1/health` remains available.

This is a local packaged preview. A real public production deployment must use HTTPS, a strong secret, and a shared rate-limit backend such as Redis rather than `memory://`.

## Verification

Backend unit/workflow suite (does not touch the application database):

```powershell
Set-Location .\backend
.\.venv\Scripts\python.exe -m pytest tests -m "not mysql" -q
```

Optional MariaDB migration suite (resets only the dedicated database whose name ends in `_test`):

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_mysql_migrations.py -m mysql -q
```

Frontend tests and production build:

```powershell
Set-Location ..\frontend
npm test
npm run build
```

## Project Structure

```text
backend/
  inventory/          Flask factory, routes, models, services, auth, CLI
  migrations/         Alembic migration history
  scripts/            Non-destructive database preparation SQL
  tests/              Unit, workflow, precision, and guarded MariaDB tests
frontend/
  src/components/     Layout and reusable accessible UI primitives
  src/features/       Auth, dashboard, catalog, inventory, partners, orders
  src/lib/            API/CSRF client and shared utilities
docs/
  DEMO_GUIDE.md       Teacher-ready video script and SQL verification
```

## Environment Safety

- Commit example files only. Never commit `backend/.env`, database passwords, session secrets, or a chosen demo password.
- Keep `DATABASE_URL` pointed at `inventorysystem` and `TEST_DATABASE_URL` pointed at the separate `inventorysystem_test` database.
- The MariaDB integration test checks that the two URLs differ and that the test database name ends with `_test` before it runs destructive migration checks.
- Do not use `db.create_all()` for setup. Run Alembic with `flask db upgrade` so constraints, indexes, collations, and append-only ledger triggers are installed.

For the presentation sequence and database queries, see `docs/DEMO_GUIDE.md`.
