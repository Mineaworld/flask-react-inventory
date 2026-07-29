# Backend Tests

Run the default backend suite with `py -3.12 -m pytest tests -q` after installing `requirements.txt`.

The default suite uses SQLite in memory. The optional `mysql` marker migrates the dedicated `TEST_DATABASE_URL` MariaDB database, verifies a Khmer `utf8mb4` insert, and confirms direct SQL cannot update or delete stock ledger rows:

```powershell
$env:TEST_DATABASE_URL = "mysql+mysqldb://root@127.0.0.1:3307/inventorysystem_test?charset=utf8mb4"
py -3.12 -m pytest tests/test_mysql_migrations.py -m mysql -q
```

Use a disposable test database only: the integration fixture downgrades it to an empty schema after the test.
