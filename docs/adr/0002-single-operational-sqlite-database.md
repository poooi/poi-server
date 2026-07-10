# Use one SQLite database for operational data

Operational data will live in a single SQLite database file separate from monthly append-only report files. This preserves one lifecycle for queried/upserted/deduplicated data, avoids cross-database joins for operational APIs, and prevents monthly dump cleanup from touching stateful records.
