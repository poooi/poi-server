# PostgreSQL deployment

poi-server selects MongoDB or PostgreSQL from `POI_SERVER_DATABASE_URL`. PostgreSQL production and CI
target PostgreSQL 18. Application startup validates the schema but never applies migrations.

## Provisioning

The same GitHub master deploy hook supports the separate MongoDB and PostgreSQL machines. Each machine
runs its own hook against its own checkout and configuration; the hook does not copy credentials or
database settings between machines.

The hook executes from a temporary copy so updating the tracked script during checkout cannot modify
the running deployment. It fetches `origin/master`, installs the configured Node.js version and
dependencies, and runs `npm run db:migrate` before pruning development dependencies or restarting
Supervisor processes. After a successful restart, it records the deployed commit and deployment time.

`db:migrate` resolves the database URL exactly as application startup does. PostgreSQL deployments apply
pending Drizzle migrations, while MongoDB deployments perform no database setup and retain their
existing deployment behavior. Migration failure aborts deployment before the server restarts.

Configure `POI_SERVER_DATABASE_URL` in the PostgreSQL machine's environment or ignored `.env` file.
Keep the connection URL, credentials, and machine-specific filesystem paths out of tracked files.
For provisioning or deployment outside the hook, apply migrations before starting the server:

```powershell
$env:POI_SERVER_DATABASE_URL = 'postgresql://user:password@host/poi'
npm run db:migrate
npm start
```

Traffic routing and cutover timing are deployment concerns. poi-server does not persist or manage a
traffic-switch boundary.

## Cutover

1. Deploy the same release to separate MongoDB-mode and PostgreSQL-mode machines.
2. On a disposable PostgreSQL 18 database, run migrations and the PostgreSQL HTTP and load preflight.
3. Provision a fresh production database and run `db:migrate`.
4. Start the PostgreSQL-mode server and inspect `/api/status`.
5. Switch traffic routing to the PostgreSQL machine. Do not mutate the MongoDB machine in place.

After PostgreSQL accepts production traffic, it is authoritative. Do not route production traffic
back to stale MongoDB data. Recover PostgreSQL through repair, replacement, or the separately
rehearsed backup/restore procedure.

## Monthly partitions

Create all nine upcoming Observation partitions before the month boundary:

```powershell
npm run db:partitions:create-upcoming -- 2026-08
```

If a default partition already contains rows for a month, repair one allowlisted Observation table
at a time:

```powershell
npm run db:partitions:repair -- create_ship_records 2026-08
```

Both commands are idempotent and reject catalog or boundary mismatches.

## Community Dumps

Configure `POI_SERVER_DUMP_R2_ENDPOINT`, `POI_SERVER_DUMP_R2_BUCKET`,
`POI_SERVER_DUMP_R2_ACCESS_KEY_ID`, and `POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY`. Optional settings are
`POI_SERVER_DUMP_R2_REGION` and `POI_SERVER_DUMP_R2_FORCE_PATH_STYLE`.

Publish a closed JST Dump Month:

```powershell
npm run db:dumps:publish -- 2026-07
```

The command streams and verifies all nine partitions, uploads immutable data objects, then uploads
the verified manifest as the publication commit point. It is safe to retry and never overwrites an
existing object.

After the seven-day grace period, clean one exact run ID:

```powershell
npm run db:dumps:cleanup -- 42
```

Cleanup re-verifies the manifest, every data object, metadata, and partition bounds before
transactionally detaching and dropping exactly nine Observation partitions. Current State,
Aggregate, Definition, and Item-improvement Fact tables are retained.

## Operational checks

- Deploy logs include timestamped stages, previous and target commit IDs, total elapsed time, and the
  failed stage and exit code. Shell tracing and environment-value logging remain disabled.
- `/api/status.database` reports the active backend and approximate counts.
- Monitor validation/database errors, pool active/idle/waiting clients, lock waits, statement
  latency, CPU, and storage latency.
- Do not store production Cloudflare credentials in CI.
- Production cutover remains blocked until PostgreSQL backup/restore has been rehearsed.
