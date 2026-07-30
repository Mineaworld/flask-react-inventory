# Inventory Management Teacher Demo Guide

This guide is designed for an 8-10 minute recorded demonstration. It combines a short architecture explanation, a role-based feature walkthrough, proof that MariaDB changes are real, and a focused code tour.

## Before Recording

- Start MySQL in XAMPP and confirm its port is `3307`.
- Confirm `backend/.env` points to `inventorysystem`, not `inventorysystem_test`.
- Keep `backend/.env`, passwords, and the XAMPP user table off screen.
- Run `flask db current` and confirm revision `20260715_0001`.
- Run the demo seed command once and verify all three demo logins.
- Use a unique product SKU for the recording, such as `VIDEO-MARKER-001`. If it already exists, change the numeric suffix.
- Close unrelated tabs and notifications. Set browser zoom so the table and navigation are visible together.
- Run the backend suite, frontend suite, and build commands from the verification section before recording.
- Prepare a MariaDB terminal or phpMyAdmin SQL tab with the read-only verification queries in this guide.

## Exact Setup And Startup

The current XAMPP server is MariaDB 10.4. SQLAlchemy connects through `mysql+mysqldb` using the same `mysqlclient` driver as the class reference project.

From the repository root in PowerShell, create any missing databases. This does not remove existing data:

```powershell
Get-Content .\backend\scripts\create_databases.sql |
  & "C:\xampp\mysql\bin\mysql.exe" --host=127.0.0.1 --port=3307 --user=root
```

Prepare Flask if this is the first run:

```powershell
Set-Location .\backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -m flask --app inventory db upgrade
```

Create or confirm the demo data. Enter a password you can type during the video:

```powershell
$DemoPassword = Read-Host "Choose the password for all three demo accounts"
.\.venv\Scripts\python.exe -m flask --app inventory seed-demo --password $DemoPassword
```

The usernames are:

| Username | Role | Password |
| --- | --- | --- |
| `demo-admin` | Admin | The value passed to `seed-demo --password` |
| `demo-manager` | Manager | The value passed to `seed-demo --password` |
| `demo-staff` | Staff | The value passed to `seed-demo --password` |

The seed does not contain a hidden default password. It hashes the chosen value and never prints it.

Start Flask in terminal 1 from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m flask --app inventory run --debug --host 127.0.0.1 --port 5000
```

Start React in terminal 2 from the repository root:

```powershell
Set-Location .\frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`.

For a one-server demonstration instead, run `npm run build`, start Flask, and open `http://127.0.0.1:5000`. Flask will serve the built React application and its client routes.

## 8-10 Minute Video Script

### 0:00-0:45 - Introduce The Project

Suggested explanation:

> This is a role-based inventory management system featuring full English and Khmer localization. React and TypeScript provide the modern user interface, Flask exposes JSON endpoints, and SQLAlchemy stores the data in the MariaDB server running through XAMPP. The important business rule is that product quantity cannot be edited directly. Every stock change is a received purchase, completed sale, or adjustment with an append-only movement record.

Show the login screen and briefly point out the language switcher (EN/KM) and that the interface is original rather than a copied admin template.

### 0:45-1:30 - Explain The Data Flow

Use this exact flow:

```text
React form
  -> React sends the form data
  -> /api/v1 Flask route with session and role check
  -> service validation and transaction
  -> SQLAlchemy models
  -> mysqlclient
  -> XAMPP MariaDB
  -> JSON response and React Query cache refresh
```

Mention that the React API client fetches a CSRF token before state-changing requests and sends the session cookie on the same origin.

### 1:30-2:15 - Show Admin And Role Boundaries

1. Log in as `demo-admin`.
2. Show the dashboard, catalog, inventory, suppliers/customers, purchases, and sales navigation.
3. Explain that Admin and Manager have the full operational workflow in this MVP.
4. Mention that Staff receives a deliberately smaller view and cannot see cost-sensitive movement history or complete stock transactions.

### 2:15-3:15 - Create A Product

1. Open **Catalog** and select **Products**.
2. Click **New product**.
3. Enter:

| Field | Demo value |
| --- | --- |
| Name | `Whiteboard Marker` |
| SKU | `VIDEO-MARKER-001` or another unique suffix |
| Category | `Demo Stationery` |
| Unit | `piece` |
| Reorder level | `5` |
| Default cost USD | `1.2000` |
| Default sale price USD | `2.00` |

4. Save and search for the SKU.
5. Explain that there is no quantity field because stock changes only through workflows.

### 3:15-4:35 - Receive A KHR Purchase

1. Sign out and log in as `demo-manager`.
2. Open **Purchases** and create a purchase.
3. Select `Phnom Penh Office Supply` and the new marker product.
4. Enter currency `KHR`, exchange rate `4100`, quantity `10`, and unit cost `4100` KHR.
5. Point out the locked conversion: `41,000 KHR / 4,100 = 10.0000 USD`.
6. Save the draft. Open its action menu and choose **Receive**.
7. Confirm receipt, then open **Inventory**.
8. Show on-hand quantity `10` and the `purchase_receipt` movement with positive quantity.

Suggested explanation:

> Receiving runs one service transaction. It locks the draft, increases the current balance, appends a movement linked to the purchase, and only then commits. If any step fails, neither the balance nor history changes.

### 4:35-5:20 - Prove The MariaDB Write

Run the product/balance and purchase/movement queries from the next section. Show that:

- the new SKU exists in `products`;
- `stock_balances.quantity` is `10.000` before the sale;
- the purchase stores `KHR` and rate `4100`;
- its movement has a positive delta and a `purchase_id`.

### 5:20-6:30 - Create A Staff Sale Draft

1. Sign out and log in as `demo-staff`.
2. Show that Catalog and Inventory are view-only and Purchases is denied.
3. Open **Sales** and create a USD draft for `SETEC Campus Shop`.
4. Add the marker product, quantity `6`, unit price `2.00`, currency `USD`, and exchange rate `1`.
5. Save the draft.
6. Open its action menu and show that Staff has edit/cancel actions but no **Complete** action.

Suggested explanation:

> The UI hides actions the role cannot perform, but security is also enforced by Flask. A direct Staff request to the completion endpoint returns forbidden.

### 6:30-7:30 - Complete The Sale As Manager

1. Sign out and log in as `demo-manager`.
2. Open **Sales**, find the Staff draft, and choose **Complete**.
3. Confirm the action.
4. Return to **Inventory** and show quantity `4`.
5. Show the negative `sale_issue` movement linked to the completed sale.

Explain that insufficient stock would reject the whole transaction without changing the balance or ledger.

### 7:30-8:25 - Show Low Stock And Dashboard Refresh

1. The marker now has quantity `4` and reorder level `5`, so enable **Low stock only** on Inventory.
2. Open the Dashboard and show the low-stock alert.
3. Change the date range and point out the received-purchase and completed-sale totals in USD.
4. Show the recent movement feed and draft counters.

### 8:25-9:30 - Short Code Tour And Close

Open files in this order:

1. `backend/inventory/__init__.py` - application factory, extensions, `/api/v1`, and built React serving.
2. `backend/inventory/config.py` - environment policy and separate test URL.
3. `backend/inventory/models.py` - decimal columns, relationships, roles, balances, and movement ledger.
4. `backend/migrations/versions/20260715_0001_initial_inventory_schema.py` - `utf8mb4`, constraints, foreign keys, and MariaDB append-only triggers.
5. `backend/inventory/services.py` - validation and atomic receive/complete operations.
6. `backend/inventory/api.py` and `backend/inventory/auth.py` - JSON routes, role decorators, sessions, CSRF, and login limiting.
7. `frontend/src/lib/api.ts` - typed fetch flow and CSRF refresh.
8. One feature page such as `frontend/src/features/orders/OrdersPage.tsx` - React Query loading, role-aware actions, dialogs, and cache refresh.
9. `frontend/src/locales/km/translation.json` - comprehensive Khmer localization for native UI support.

Close with:

> The result is a modern React interface backed by real Flask transactions and MariaDB constraints. The same workflow is tested at the service, API, UI, build, and migration levels.

## MariaDB Verification Queries

Run these read-only queries in phpMyAdmin or the XAMPP MariaDB client. On Windows XAMPP, `InventorySystem` and `inventorysystem` resolve to the same database name.

```sql
USE InventorySystem;
```

### Demo accounts and roles

```sql
SELECT id, username, full_name, role, is_active
FROM users
WHERE username IN ('demo-admin', 'demo-manager', 'demo-staff')
ORDER BY id;
```

Expected: three active rows with roles `admin`, `manager`, and `staff`. Password hashes are intentionally not selected.

### Product and current balance

```sql
SELECT
    p.id,
    p.sku,
    p.name,
    c.name AS category,
    p.reorder_level,
    COALESCE(sb.quantity, 0) AS on_hand
FROM products AS p
JOIN categories AS c ON c.id = p.category_id
LEFT JOIN stock_balances AS sb ON sb.product_id = p.id
WHERE p.sku = 'VIDEO-MARKER-001';
```

Expected: `10.000` after receipt, then `4.000` after completing the six-unit sale.

### KHR purchase and locked USD values

```sql
SELECT
    pu.document_number,
    pu.status,
    pu.currency,
    pu.exchange_rate_to_usd,
    pu.total_amount,
    pu.total_usd,
    pr.sku,
    pi.quantity,
    pi.unit_price AS unit_price_document_currency,
    pi.unit_price_usd,
    pi.line_total,
    pi.line_total_usd
FROM purchases AS pu
JOIN purchase_items AS pi ON pi.purchase_id = pu.id
JOIN products AS pr ON pr.id = pi.product_id
WHERE pr.sku = 'VIDEO-MARKER-001'
ORDER BY pu.id DESC;
```

Expected for the recorded purchase: currency `KHR`, rate `4100.000000`, quantity `10`, unit price `4100.00`, line total `41000.00`, and line total USD `10.0000`.

### USD sale and completion user

```sql
SELECT
    s.document_number,
    s.status,
    s.currency,
    s.exchange_rate_to_usd,
    creator.username AS created_by,
    completer.username AS completed_by,
    pr.sku,
    si.quantity,
    si.unit_price,
    si.line_total_usd
FROM sales AS s
JOIN sale_items AS si ON si.sale_id = s.id
JOIN products AS pr ON pr.id = si.product_id
JOIN users AS creator ON creator.id = s.created_by_id
LEFT JOIN users AS completer ON completer.id = s.completed_by_id
WHERE pr.sku = 'VIDEO-MARKER-001'
ORDER BY s.id DESC;
```

Expected: Staff is `created_by`, Manager is `completed_by`, status is `completed`, currency is `USD`, rate is `1.000000`, quantity is `6`, and USD line total is `12.0000`.

### Append-only movement relationships

```sql
SELECT
    sm.id,
    p.sku,
    sm.movement_type,
    sm.quantity_delta,
    sm.unit_cost_usd,
    pu.document_number AS purchase_document,
    s.document_number AS sale_document,
    u.username AS recorded_by,
    sm.created_at
FROM stock_movements AS sm
JOIN products AS p ON p.id = sm.product_id
JOIN users AS u ON u.id = sm.created_by_id
LEFT JOIN purchases AS pu ON pu.id = sm.purchase_id
LEFT JOIN sales AS s ON s.id = sm.sale_id
WHERE p.sku = 'VIDEO-MARKER-001'
ORDER BY sm.id;
```

Expected: a positive `purchase_receipt` linked only to a purchase and a negative `sale_issue` linked only to a sale.

### Balance equals the ledger sum

```sql
SELECT
    p.sku,
    sb.quantity AS cached_on_hand,
    COALESCE(SUM(sm.quantity_delta), 0) AS ledger_on_hand
FROM products AS p
JOIN stock_balances AS sb ON sb.product_id = p.id
LEFT JOIN stock_movements AS sm ON sm.product_id = p.id
WHERE p.sku = 'VIDEO-MARKER-001'
GROUP BY p.id, p.sku, sb.quantity;
```

Expected: `cached_on_hand` equals `ledger_on_hand`; both are `4.000` after the demo.

### Low-stock and dashboard stock value calculations

```sql
SELECT p.sku, p.name, sb.quantity, p.reorder_level
FROM products AS p
JOIN stock_balances AS sb ON sb.product_id = p.id
WHERE p.is_active = 1
  AND sb.quantity <= p.reorder_level
ORDER BY p.name;

SELECT ROUND(COALESCE(SUM(sb.quantity * p.default_cost_usd), 0), 4) AS stock_value_usd
FROM products AS p
LEFT JOIN stock_balances AS sb ON sb.product_id = p.id
WHERE p.is_active = 1;
```

Expected: the marker appears in the first query at `4 <= 5`. The second query matches the dashboard stock-value metric, subject to the same active products.

### Schema and immutable-ledger proof

```sql
SELECT TABLE_NAME, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

SHOW TRIGGERS FROM InventorySystem LIKE 'stock_movements';
```

Expected: inventory tables use an `utf8mb4_` collation, and `stock_movements_no_update` plus `stock_movements_no_delete` are present. Do not run UPDATE or DELETE against the application ledger during the demo.

## Code Explanation Cheat Sheet

- **Why two stock tables?** `stock_balances` makes current quantity fast to read; `stock_movements` is the permanent audit trail. A service transaction writes both together.
- **Why decimals?** Quantities, money, USD values, and exchange rates use database `DECIMAL` and Python `Decimal`, avoiding floating-point errors.
- **Why session cookies instead of JWT?** The React build and Flask API are same-origin, so server-managed sessions are simpler and can be protected with CSRF.
- **Why react-i18next?** To support native English and Khmer localization dynamically in the UI without complex backend rendering.
- **Why service functions?** They keep the route code short and put validation, stock checks, and database saving in one place.
- **Why React Query?** It loads API data, shows loading or error states, and refreshes the page data after saving.
- **Why Alembic?** Migrations reproduce the exact schema, including foreign keys, checks, `utf8mb4`, indexes, and append-only triggers; `db.create_all()` would not provide that history.

## Troubleshooting

### XAMPP MySQL is stopped or unreachable

- In XAMPP Control Panel, click **Start** beside MySQL and wait for the green running state.
- Confirm `C:\xampp\mysql\bin\my.ini` uses port `3307`.
- Check the listener without changing it:

```powershell
Get-NetTCPConnection -LocalPort 3307 -State Listen
```

- Confirm connectivity:

```powershell
& "C:\xampp\mysql\bin\mysql.exe" --host=127.0.0.1 --port=3307 --user=root -e "SELECT VERSION();"
```

### `backend/.env` is invalid

- The URL must begin with `mysql+mysqldb://`.
- Use `127.0.0.1:3307`, database `inventorysystem`, and `?charset=utf8mb4`.
- If root has a password, use `root:YOUR_PASSWORD@...`. URL-encode reserved characters in passwords, or create the dedicated app user shown in `backend/scripts/create_databases.sql`.
- Keep `FLASK_ENV=development` for this local HTTP demo. Production cookie settings require HTTPS.

### Tables are missing or a migration is unapplied

From `backend/`:

```powershell
.\.venv\Scripts\python.exe -m flask --app inventory db current
.\.venv\Scripts\python.exe -m flask --app inventory db upgrade
```

Do not replace migrations with `db.create_all()`.

### Port 5000 or 5173 is occupied

Identify the owner first:

```powershell
Get-NetTCPConnection -LocalPort 5000,5173 -State Listen |
  Select-Object LocalPort,OwningProcess
```

Close the correct previous development process. Vite currently proxies to Flask on port `5000`, so keep that backend port for the demo. Vite itself may use another port, but open the URL it prints.

### CSRF failure

- Refresh the page so the API client requests a fresh token.
- Sign out and sign back in if the session was left open for more than an hour.
- Do not mix `localhost` and `127.0.0.1`; cookies belong to the host used in the browser.
- With separate development servers, open Vite on `127.0.0.1:5173` and let its `/api` proxy call Flask. Do not call Flask cross-origin from the browser.

### Flask root says the frontend build is missing

This is expected when using Flask as a single server before building React:

```powershell
Set-Location .\frontend
npm ci
npm run build
```

Restart Flask only if needed, then open `http://127.0.0.1:5000`. The API health check remains available at `http://127.0.0.1:5000/api/v1/health` even without the frontend build.
