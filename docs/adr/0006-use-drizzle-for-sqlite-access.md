# Use Drizzle for SQLite access

SQLite access will use Drizzle ORM with a SQLite driver rather than raw SQL scattered through controllers. This keeps schemas and repositories typed while still allowing explicit SQLite transactions, pragmas, and backend-specific actions where the SQLite design differs from MongoDB or PostgreSQL.
