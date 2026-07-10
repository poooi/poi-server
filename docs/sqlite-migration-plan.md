# SQLite migration plan

## Goals

Add SQLite as a supported persistence backend for a single-server poi-server deployment. The SQLite
design separates append-only report data from operational data so monthly community dumps can publish
and remove dumpable records without touching stateful records.

The design must preserve existing public HTTP behavior and preserve the public dump record shape as
much as practical for append-only report data.

## Non-goals

- Removing MongoDB support during the migration.
- Migrating existing MongoDB data into SQLite before traffic switch.
- Using Cloudflare D1 as the primary write store for this plan.
- Removing operational data as part of monthly community dump cleanup.
- Changing public dump consumers to a new format unless a separate compatibility plan accepts that
  break.

## Measured capacity inputs

Production measurements used for this plan:

| Metric | Observed value |
| --- | ---: |
| Published append-only records, 2025-07-01 through 2026-07-01 | 100,439,027 |
| Average published append-only records per month | 8,369,919 |
| Peak published append-only month | 13,405,020 |
| Peak published append-only day | 622,331 |
| Peak published append-only hour | 49,313 |
| Peak published append-only minute | 1,264 |
| Peak published append-only second | 47 |

These counts cover the current public dumped write-only collections:

- `dropshiprecords`
- `createitemrecords`
- `createshiprecords`
- `nightcontactrecords`
- `aacirecords`

They do not include operational collections such as `enemyinfos`, `shipstats`, `quests`,
`questrewards`, `reciperecords`, or item-improvement fact collections.

## Data classification

### Append-only report data

Append-only report data is write-only data that exists to be included in monthly community dumps and
then removed from live storage. In the current implementation this scope is limited to:

| Current Mongo collection | Current write path | SQLite lifecycle |
| --- | --- | --- |
| `dropshiprecords` | `DropShipRecord.save()` | Monthly SQLite file |
| `createitemrecords` | `CreateItemRecord.save()` | Monthly SQLite file |
| `createshiprecords` | `CreateShipRecord.save()` | Monthly SQLite file |
| `nightcontactrecords` | `NightContactRecord.save()` | Monthly SQLite file |
| `aacirecords` | `AACIRecord.save()` when accepted | Monthly SQLite file |

These collections currently have no explicit secondary indexes and are not queried by application
handlers after insert.

### Operational data

Operational data is stateful data that remains in live storage because the application queries,
upserts, deduplicates, or exports it through APIs. It must not be removed by monthly community dump
cleanup.

This includes at least:

- `battleapis`
- `enemyinfos`
- item-improvement fact collections
- `nightbattlecis`
- `passeventrecords`
- `questrewards`
- `quests`
- `reciperecords`
- `remodelitemrecords`
- `selectrankrecords`
- `shipstats`

## SQLite storage layout

Use one SQLite file per report receipt month for append-only report data:

```text
data/
  sqlite/
    append-only/
      append-only-2026-07.sqlite
      append-only-2026-08.sqlite
    operational.sqlite
```

Each monthly append-only SQLite file contains all five append-only tables. Do not split by collection
unless `dropshiprecords` needs independent retry or storage handling later.

`operational.sqlite` contains all non-append-only operational tables and has a separate backup policy.

## Backend selection

Select the active backend from the configured database URL scheme. Keep MongoDB as the default
development backend until SQLite implementation and parity tests are complete.

Suggested schemes:

| URI scheme | Backend |
| --- | --- |
| `mongodb:` | MongoDB |
| `mongodb+srv:` | MongoDB |
| `sqlite:` | SQLite |

Example:

```dotenv
POI_SERVER_DATABASE_URL=sqlite:///var/lib/poi-server/sqlite/operational.sqlite
POI_SERVER_SQLITE_APPEND_ONLY_DIR=/var/lib/poi-server/sqlite/append-only
```

The append-only directory is separate from the operational database URL because append-only writes are
routed by report receipt month.

## SQLite access layer

Use Drizzle ORM with a SQLite driver such as `better-sqlite3`.

Use backend-specific actions/repositories rather than forcing MongoDB and SQLite through a
lowest-common-denominator abstraction. Shared code should include route registration, request parsing,
HTTP result helpers, Sentry capture, and Cloudflare cache headers. Persistence actions should be
backend-specific.

Suggested layout:

```text
src/db/
  backend.ts
  mongo.ts
  sqlite/
    operational.ts
    append-only-registry.ts
    schema/
      append-only.ts
      operational.ts
src/controllers/api/report/
  v2.mongo.actions.ts
  v2.sqlite.actions.ts
  v3.mongo.actions.ts
  v3.sqlite.actions.ts
```

## Append-only month routing

Route append-only writes by server receipt time.

```text
receive request
→ serverReceivedAt = Date.now()
→ reportReceiptMonth = YYYY-MM from serverReceivedAt
→ db = appendOnlyRegistry.get(reportReceiptMonth)
→ insert
→ return success only after commit
```

Do not use client-provided timestamps or payload fields to choose the monthly file.

The registry must cache long-lived SQLite handles. It should not physically open the SQLite file for
every insert. Normal insert overhead should be a month-string calculation and a map lookup.

The previous month becomes dumpable only after the rollover grace window, which lasts until the next
day. This avoids racing in-flight requests that computed the previous month before the boundary.

## Append-only schema rules

Append-only tables use typed columns matching the current Mongoose schemas, plus storage metadata:

- `id INTEGER PRIMARY KEY`
- `public_id TEXT NOT NULL`
- `received_at_ms INTEGER NOT NULL`
- current report fields from the matching Mongoose schema

`id` is the internal cutoff/export/delete identity. `public_id` is a stable generated 24-hex value used
as the `_id` value in published dumps so retries produce consistent dump rows.

Do not add secondary indexes to append-only tables unless a real query requirement appears. The
current implementation does not query these records after insert.

## Write concurrency and backpressure

All SQLite writes should go through bounded per-database-file write queues.

Queues are required to:

- make SQLite's single-writer behavior explicit;
- expose queue depth and write latency metrics;
- prevent unbounded memory growth during bursts;
- isolate current-month append-only writes from operational database writes;
- provide a clear backpressure point.

If a queue is full or the database is temporarily overloaded, return a retryable HTTP `503` and log
the rejection with enough context for diagnostics. Do not return success until the write has committed.

An acknowledged report is one that has been committed to storage.

## Monthly dump workflow

The monthly dump job runs as an external scheduled maintenance job, not inside the API server process.
Use systemd timers, cron, or an equivalent scheduler on the single server.

The job operates only on inactive append-only monthly SQLite files older than the rollover grace
window.

Workflow:

1. Discover dumpable append-only SQLite files.
2. Open the inactive monthly SQLite file read-only.
3. Export each append-only table in the public dump record shape.
4. Produce per-table row counts.
5. Produce per-table content checksums.
6. Compress the dump artifact.
7. Produce the compressed file checksum.
8. Upload/publish to the community dump location.
9. Verify the uploaded object is present and matches the checksum.
10. Mark the dump as validated.
11. Remove the local monthly SQLite file only after validation succeeds.

Do not delete or mutate active monthly SQLite files. Do not remove operational data during this job.

## Dump format

The new dump pipeline should preserve the public dump record shape as much as practical. Internal
SQLite details such as `id` and `received_at_ms` should not leak unless deliberately added as
backward-compatible metadata.

The dump exporter should map `public_id` to `_id` in the published output.

The exact dump container format is still an implementation decision. Before implementation, choose and
document whether the new dumps remain Mongo archive-compatible, switch to NDJSON, or publish both
formats during a transition.

## Operational database backups

`operational.sqlite` is not part of monthly community dump cleanup. It needs a separate backup policy.

Recommended baseline:

- periodic SQLite backup snapshots;
- compressed backup artifacts;
- checksums;
- retention policy independent from community dumps;
- restore rehearsal before production traffic switch.

## Pragmas and operational settings

SQLite production files should use settings appropriate for a single-server write-heavy service:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

Tune these under benchmark rather than assuming defaults are sufficient.

## Observability

Add structured logs and metrics for:

- append-only write queue depth;
- operational write queue depth;
- write latency;
- queue-full rejections;
- SQLite busy retries/errors;
- active append-only month;
- open SQLite handles;
- monthly dump start/end/failure;
- dump validation row counts and checksums;
- upload verification;
- cleanup decisions.

## Implementation phases

### Phase 1: Schema contract

- Define the exact SQLite table matrix for append-only and operational data.
- Define Drizzle schemas for append-only tables.
- Define Drizzle schemas for operational tables.
- Define `public_id` generation.
- Define dump serialization for each append-only table.

### Phase 2: SQLite backend skeleton

- Add backend selection for `sqlite:` URLs.
- Add SQLite connection management.
- Add append-only monthly database registry.
- Add operational database connection.
- Add bounded write queues.

### Phase 3: Append-only write parity

- Implement SQLite actions for:
  - `create_ship`
  - `create_item`
  - `drop_ship`
  - `night_contcat`
  - `aaci`
- Add parity tests against current Mongo behavior.
- Add queue-full tests that return retryable `503`.

### Phase 4: Operational data parity

- Implement SQLite actions for stateful and upsert-heavy collections.
- Preserve current public HTTP behavior.
- Add parity tests for operational endpoints and v3 item-improvement exports.

### Phase 5: Monthly dump job

- Implement external dump CLI/job.
- Export inactive monthly SQLite files.
- Validate counts and checksums.
- Upload/publish dumps.
- Delete only validated local monthly files.
- Add dry-run mode.

### Phase 6: Benchmarks and production readiness

- Replay realistic append-only write mixes from measured dump/log data.
- Benchmark peak burst target with headroom above 47 append-only writes/s.
- Benchmark dump job on worst observed monthly file size.
- Validate queue behavior under overload.
- Rehearse restore from operational backup.
- Run Mongo and SQLite deployments separately before traffic switch.

## Open questions before implementation

- Exact public dump container format after SQLite migration.
- Exact `public_id` generation algorithm.
- Exact operational table schemas and unique constraints.
- Whether `battleapis`, `nightbattlecis`, and `passeventrecords` should remain operational or be
  reconsidered as future dumpable append-only data.
- Whether dump files should be generated on-server or copied elsewhere for compression/publication.
- Backup retention duration for `operational.sqlite`.

## Acceptance criteria

- MongoDB behavior remains available until SQLite is explicitly selected.
- SQLite mode can ingest append-only reports into the correct monthly file by server receipt time.
- Success is returned only after storage commit.
- Queue overload returns retryable `503` instead of acknowledged data loss.
- Monthly dump job exports only inactive append-only monthly files.
- Monthly dump job deletes a monthly SQLite file only after validation and upload verification.
- Operational data is never removed by community dump cleanup.
- Public HTTP endpoint behavior remains compatible with the MongoDB backend.
- Public dump record shape is preserved as much as practical.
