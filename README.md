# poi-server

![service status](https://api.poi.moe/api/service-status-badge)
![service version](https://api.poi.moe/api/service-version-badge)

poi server.

## Usage

See the [wiki](https://github.com/poooi/poi-server/wiki).

## Storage backends

The configured database URL selects the persistence backend:

| URL scheme                  | Backend       |
| --------------------------- | ------------- |
| `mongodb:` / `mongodb+srv:` | MongoDB       |
| `postgres:` / `postgresql:` | PostgreSQL 18 |

Set `POI_SERVER_DATABASE_URL`; `POI_SERVER_DB` remains a backward-compatible fallback. PostgreSQL
startup validates the explicit Drizzle migration version and never runs migrations automatically.

## Development

Prerequisites:

- Node.js 24 or newer
- MongoDB 4.4 for MongoDB-mode tests
- PostgreSQL 18 for PostgreSQL-mode tests

Setup:

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and configure a database URL.
3. Start the selected database.
4. Run `npm start`.

Validation commands are `npm test`, `npm run type-check`, and `npm run lint`. PostgreSQL deployment,
partition maintenance, and Community Dump commands are documented in
[`docs/postgresql-deployment.md`](docs/postgresql-deployment.md).
