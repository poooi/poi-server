# Use explicit better-sqlite3 repositories for SQLite access

SQLite access will use explicit backend-specific repository/action functions over `better-sqlite3`, rather than adding an ORM dependency before the SQLite table shapes and dump lifecycle have stabilized. SQL should remain centralized in the SQLite persistence modules, not scattered through HTTP controllers.
