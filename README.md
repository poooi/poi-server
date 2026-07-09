# poi-server

![service status](https://api.poi.moe/api/service-status-badge)
![service version](https://api.poi.moe/api/service-version-badge)

poi server.

## Usage

See the [wiki](https://github.com/poooi/poi-server/wiki).

## Development

### Prerequists:

- Node.js 14.x
- MongoDB v4.2 or PostgreSQL 16

Other versions are not tested

### Setup

- Install dependencies with npm install
- copy `.env.example` to create `.env`, this contains config file for the server
- set `POI_SERVER_DATABASE_URL` to choose the backend by URI scheme: `mongodb://` / `mongodb+srv://` runs MongoDB mode, and `postgres://` / `postgresql://` runs PostgreSQL mode. `POI_SERVER_DB` remains a legacy fallback, but `POI_SERVER_DATABASE_URL` is preferred.
- start the matching database service; for PostgreSQL on a fresh database, run `npm run db:migrate` before starting the server
- start the server by `npm start`

### PostgreSQL operations

- The same server codebase supports MongoDB mode and PostgreSQL mode; only the configured database URL changes the active backend.
- `npm run dump:monthly` exports the most recently closed UTC calendar month of append-heavy PostgreSQL report tables to JSONL files and then cleans up only those dumped rows after verification. It never deletes stateful aggregate tables or item-improvement fact tables.
- Set `POI_SERVER_DUMP_DIR` if dumps should be written somewhere other than the default `dumps/` directory in the repository root.

### Rollout and fallback

For PostgreSQL rollout, use two machines running the same code: keep one in MongoDB mode, bring up a second in PostgreSQL mode, run migrations there, validate it, then switch traffic. Fallback is switching traffic back to the MongoDB-mode machine, not flipping one machine's URI in place. See `docs/postgresql-migration-plan.md` for the full operational sequence.
