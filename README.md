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

## Deployment hook

`POST /api/github-master-hook` starts the tracked `github-master-hook` deployment script and returns
without waiting for deployment to finish. The script safely continues from a temporary copy while it:

1. Fetches and checks out `origin/master`.
2. Installs the repository's configured Node.js version and dependencies.
3. Runs `npm run db:migrate`.
4. Prunes development dependencies and restarts the application and hook processes through Supervisor.
5. Records the deployed commit and deployment time.

`db:migrate` applies pending Drizzle migrations when `POI_SERVER_DATABASE_URL` selects PostgreSQL. It
performs no database setup for MongoDB, preserving the existing MongoDB deployment flow. A PostgreSQL
migration failure stops the deployment before the application restarts.

The hook emits timestamped stage logs, previous and target commit IDs, elapsed time, and the failed
stage and exit code when a command aborts deployment. It does not enable shell tracing or intentionally
log environment values, credentials, or machine paths.

Keep machine-specific database URLs, credentials, and filesystem layout outside the repository. See
[`docs/postgresql-deployment.md`](docs/postgresql-deployment.md) for PostgreSQL provisioning and
operations.

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
[`docs/postgresql-deployment.md`](docs/postgresql-deployment.md). The current persisted report
datasets and their retention classifications are listed in
[`docs/report-data.md`](docs/report-data.md).
