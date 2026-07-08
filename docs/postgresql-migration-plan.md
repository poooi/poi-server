# PostgreSQL migration plan

## Goals

Add PostgreSQL as a supported persistence backend while keeping MongoDB available. The active backend
is selected from the configured database URI scheme. Existing MongoDB data will not be migrated; a
PostgreSQL deployment starts with empty reporting tables.

## Non-goals

- Migrating existing MongoDB records into PostgreSQL.
- Removing MongoDB support.
- Reworking the public HTTP API shape during the storage migration.

## Backend selection

Select the active backend from the configured database URI. Do not add a separate driver environment
variable; the URI scheme is already enough to distinguish MongoDB from PostgreSQL.

```dotenv
POI_SERVER_DATABASE_URL=mongodb://localhost:27017/poi-development
```

`POI_SERVER_DATABASE_URL` should be the preferred configuration name. Existing deployments can keep
using `POI_SERVER_DB` as a backward-compatible fallback:

```ts
const databaseUrl = process.env.POI_SERVER_DATABASE_URL ?? process.env.POI_SERVER_DB
```

Backend selection maps URI schemes as follows:

| URI scheme | Backend |
| --- | --- |
| `mongodb:` | MongoDB |
| `mongodb+srv:` | MongoDB |
| `postgres:` | PostgreSQL |
| `postgresql:` | PostgreSQL |

Unsupported schemes should fail startup with a redacted connection string. The default development
configuration should remain MongoDB for backward compatibility.

## Architecture

Use backend-specific action/controller implementations instead of forcing MongoDB and PostgreSQL
through a lowest-common-denominator repository abstraction.

The shared layer should include:

- Route paths and Fastify route registration shape.
- HTTP result helpers.
- Request metadata helpers.
- Public request/response schemas when they represent API contracts.
- Cross-cutting behavior such as Sentry capture and Cloudflare cache headers.

The backend-specific layer should include:

- MongoDB actions that keep the existing Mongoose behavior stable.
- PostgreSQL actions that use Drizzle ORM and PostgreSQL-native constraints.
- Backend-specific schema validation when it improves clarity or catches persistence constraints
  earlier.

Example module layout:

```text
src/db/
  backend.ts
  mongo.ts
  postgres.ts
src/controllers/api/report/
  v2.mongo.actions.ts
  v2.postgres.actions.ts
  v3.mongo.actions.ts
  v3.postgres.actions.ts
```

The backend is resolved once at startup and passed into app/route creation so route registration can
select the matching action set.

## Implementation readiness

The design direction is ready for review, but the implementation contract is not yet strict enough to
delegate directly to an implementation agent. Before implementation starts, extend this plan or add a
follow-up implementation contract with:

- An exact Mongo model to PostgreSQL table matrix for every persisted record.
- Column names, Drizzle types, nullability, defaults, arrays, JSONB fields, generated columns, indexes,
  and unique keys for every PostgreSQL table.
- Dump classification for every table: write-only dumpable table, stateful aggregate table, or
  item-improvement fact table.
- Retention behavior for every dumpable table, including partitioning, dump verification, and cleanup
  rules.
- Per-endpoint parity tests that must pass against both MongoDB and PostgreSQL.
- Acceptance criteria stating that the implementation is incomplete until the same HTTP behavior suite
  passes against MongoDB and a real PostgreSQL service.

Implementation should not infer table shape from examples or from the high-level outline alone.
Schema details and parity tests are part of the contract, not implementation guesswork.

Validation should be split by responsibility:

- Keep Zod schemas for public HTTP payload contracts and shared parsing behavior.
- Use Drizzle schema definitions as the source of truth for PostgreSQL table shape.
- Use `drizzle-zod` or equivalent schema derivation where it improves maintainability, but do not
  replace endpoint-specific validation rules that are stricter than table constraints.

## PostgreSQL ORM choice

Use Drizzle ORM with the node-postgres driver.

Drizzle is the preferred fit because it provides:

- TypeScript-first schema definitions.
- Readable query construction.
- PostgreSQL-native arrays, JSONB, indexes, and conflict handling.
- Migration tooling.
- Schema-driven validation support through companion tooling such as `drizzle-zod`.
- Raw SQL escape hatches for small PostgreSQL expressions while keeping most queries structured.

Other options considered:

| Option | Reason not chosen |
| --- | --- |
| Prisma | Excellent generated client, but PostgreSQL-specific upsert details and array set-union updates are more awkward. Generated client lifecycle is also a larger shift for this service. |
| TypeORM | Mature, but its entity/decorator lifecycle model is heavier than needed and less aligned with explicit backend actions. |
| Sequelize | Runtime-model oriented and weaker TypeScript/schema ergonomics for a new TypeScript migration. |
| Kysely or raw `pg` | Good SQL control, but not an ORM in the desired sense and would require more hand-rolled schema/migration conventions. |

Raw SQL fragments are acceptable inside Drizzle expressions for small PostgreSQL-specific pieces such
as `least`, `greatest`, JSONB/array set-union updates, or generated export IDs when Drizzle cannot
express the operation cleanly.

## MongoDB behavior baseline

Before adding PostgreSQL behavior, move the current Mongoose logic into Mongo-specific actions
without changing behavior. This gives a safe baseline and makes the PostgreSQL implementation easier
to review independently.

Current MongoDB-specific behavior to preserve:

- Append-only report inserts for simple report endpoints.
- `drop_ship` clears `ownedShipSnapshot` for `mapId < 73` before persistence.
- `select_rank` upsert by admiral and map area.
- `remodel_recipe` upsert and count increment, while ignoring `stage === -1`.
- `remodel_recipe_deduplicate` duplicate cleanup by recipe key.
- `ship_stat` count increments by stat tuple.
- `enemy_info` count increments plus bomber range min/max merging.
- `aaci` persists only when the POI version is greater than `7.9.1`, the reporter origin starts with
  `Reporter `, and the reporter version is at least `3.6.0`.
- Legacy no-op routes remain no-ops, including `quest/:id` and `night_battle_ss_ci`.
- Preserve legacy route spelling, including `/api/report/v2/night_contcat`.
- v2 `known_quests` sort behavior.
- v3 quest and quest reward upserts by stable quest hash fields.
- v3 item-improvement ingestion, export filtering, export ordering, cursor behavior, and omission of
  reporter origins.

## Status endpoint compatibility

`GET /api/status` currently returns a `mongo` object containing model counts. The storage migration
should not silently break clients that consume that response shape.

During the compatibility phase, return both:

- `database`: generic backend metadata and table/model counts.
- `mongo`: legacy count object, populated from the active backend even when PostgreSQL is selected.

A later API cleanup can deprecate or remove `mongo`, but that should be separate from the PostgreSQL
storage migration.

## PostgreSQL schema outline

Use typed scalar columns for fields used in queries, uniqueness, and exports. Use PostgreSQL arrays
for primitive arrays and JSONB for flexible nested report payloads that are not queried structurally.
Use BIGINT for millisecond timestamps, but define Drizzle columns with number-mode parsing so JSON
responses keep the current numeric timestamp contract instead of returning node-postgres `int8`
strings.

Use a hybrid schema so PostgreSQL keeps MongoDB's extensibility where the API depends on flexible
report payloads:

- Typed columns are required for fields used in lookups, uniqueness, ordering, aggregation, public
  exports, and status counts.
- Every report table that corresponds to a client-submitted record should include a JSONB field such
  as `raw_payload` or `extra` to preserve flexible and newly reported fields that are not yet part of
  query semantics.
- Field extension is expected, not exceptional. If a future client adds fields to a certain data
  record, PostgreSQL ingestion should retain those fields in JSONB without requiring an immediate
  schema migration, as long as those fields are not needed for filtering, uniqueness, aggregation, or
  exported stable API shape.
- When a JSONB field becomes behavior-driving, promote it to a typed column through a Drizzle
  migration, optionally backfill from JSONB, and write future records to the typed column.
- Do not force every report field into rigid columns on day one; do not leave behavior-driving fields
  only in JSONB.
- Tests should include at least one representative report with an unknown future field and assert the
  PostgreSQL backend stores it without rejecting the payload or losing the field.

Flexible-field write behavior must be explicit:

- Do not pass parsed report objects directly to Drizzle and assume unknown keys are preserved. Drizzle
  only writes declared columns.
- Each PostgreSQL action must split a parsed report into typed column values plus JSONB payload values
  before insert/upsert.
- For append-only records, store at least the unknown extension fields in JSONB. Prefer storing the
  normalized full report payload in `raw_payload` when that makes future field promotion and debugging
  safer.
- For upsert records, conflict updates must merge JSONB instead of overwriting it. Use an explicit
  JSONB merge expression such as `raw_payload = existing.raw_payload || excluded.raw_payload`, unless a
  table-specific contract chooses insert-only payload preservation.
- If a stored record is returned by an API, flatten the JSONB payload back into the response shape and
  then apply typed columns over it, omitting internal columns such as `raw_payload`, generated hashes,
  and private fields like `origins` where the current API omits them.

Append-heavy report tables:

- `create_ship_records`
- `create_item_records`
- `remodel_item_records`
- `drop_ship_records`
- `pass_event_records`
- `battle_apis`
- `night_contacts`
- `aaci_records`
- `night_battle_cis`

These append-heavy tables are write-only reporting records. They should be designed as dumpable
retention tables: the service writes them, monthly jobs publish their data to the community, and old
dumped data can be removed from PostgreSQL to control disk usage.

Upsert/aggregate report tables:

- `select_rank_records`
- `recipe_records`
- `ship_stats`
- `enemy_infos`
- `quests`
- `quest_rewards`

Item-improvement fact tables:

- `item_improvement_availability_facts`
- `item_improvement_cost_facts`
- `item_improvement_update_facts`

Upsert/aggregate tables and item-improvement fact tables are stateful service data, not write-only
dump buffers. They may be included in community dumps as snapshots if useful, but they must not be
emptied as part of the write-only record cleanup path.

## Community data dumps and retention

PostgreSQL design must support monthly community data dumps and disk-space reclamation.

Dump policy:

- Dump write-only append-heavy report tables monthly after the month has closed.
- After a dump is successfully published and verified, remove the dumped write-only records from
  PostgreSQL.
- Do not empty stateful aggregate tables such as `select_rank_records`, `recipe_records`,
  `ship_stats`, `enemy_infos`, `quests`, `quest_rewards`, or item-improvement fact tables as part of
  write-only retention cleanup.

Schema requirements for dumpable write-only tables:

- Add an internal ingestion timestamp such as `ingested_at` to every write-only report table, even if
  the current MongoDB schema did not record one. This timestamp is for dump partitioning and retention,
  not part of the public API contract.
- Prefer monthly range partitioning by `ingested_at` for high-volume write-only tables so cleanup can
  detach/drop or truncate whole dumped partitions instead of issuing large row-by-row deletes.
- Keep typed columns for commonly useful community-analysis fields and preserve the full normalized
  report payload in JSONB so future fields are included in dumps.
- Keep dump metadata in a small control table, for example `data_dump_runs`, recording dump month,
  table or partition name, row count, checksum or manifest hash, output location, completion time, and
  cleanup time.

Dump workflow:

1. Select closed monthly partitions or rows for write-only tables.
2. Export them to the chosen community dump format.
3. Verify row counts and checksums against `data_dump_runs`.
4. Publish the dump.
5. Only after successful verification and publication, detach/drop or truncate the dumped write-only
   partitions.

The implementation contract must define the exact dump format, storage location, metadata columns,
and cleanup command before enabling automated cleanup.

Important indexes and constraints:

- Unique `key` on item-improvement fact tables.
- `(last_reported, export_id)` index on item-improvement fact tables for export pagination.
- Lookup indexes equivalent to existing Mongoose item-improvement indexes:
  - availability: `(item_id, observed_second_ship_id, day)`, `recipe_id`
  - costs: `(item_id, observed_second_ship_id, day, item_level)`, `recipe_id`
  - updates: `(item_id, observed_second_ship_id, day, item_level)`, `recipe_id`, `upgrade_to_item_id`
- Unique upsert keys for tables that currently emulate uniqueness through query/update patterns.

Concrete PostgreSQL upsert keys:

| Table | Upsert/uniqueness key |
| --- | --- |
| `select_rank_records` | `(teitoku_id, maparea_id)` |
| `recipe_records` | `(recipe_id, item_id, stage, day, secretary)` |
| `ship_stats` | `(ship_id, lv, los, los_max, asw, asw_max, evasion, evasion_max)` |
| `enemy_infos` | Stable hash of the canonical enemy fleet fields plus `planes`; nested arrays are stored in JSONB and are not used directly as a multi-column unique key. |
| `quests` | `(key, quest_id, category)` |
| `quest_rewards` | `(key, quest_id, selections, bonus_count)` using PostgreSQL's native equality support for primitive array columns. The PostgreSQL column should use the corrected `bonus_count` name while the HTTP payload parser continues accepting the legacy `bounsCount` field. |
| item-improvement facts | `key` |

The legacy `remodel_recipe_deduplicate` endpoint should remain available. For PostgreSQL it should
normally return an empty deletion list because the unique key prevents new duplicates; existing
MongoDB duplicate cleanup remains Mongo-specific.

## Semantic mapping

| Current MongoDB semantic | PostgreSQL/Drizzle design |
| --- | --- |
| `new Model(info).save()` | Split `info` into declared typed columns and JSONB extension payload, then insert values including the `raw_payload` column |
| `count()` / `countDocuments()` | Drizzle `count()` helper or `select count(*)` expression |
| `distinct('questId')` | A Drizzle distinct projection such as `selectDistinct({ questId: table.questId }).from(table)`; preserve current endpoint sort behavior |
| `findOne` then mutate/save for select rank | Unique key on `(teitoku_id, maparea_id)` with conflict update |
| `$setOnInsert` | Conflict update with immutable insert-only fields omitted from the update set |
| `$inc` | `count = table.count + 1` |
| `$min` | `first_client_observed_at = least(existing, excluded)` |
| `$max` | `last_reported = greatest(existing, excluded)` and same for client observed timestamp |
| `$addToSet` scalar or `$each` arrays | PostgreSQL array set-union expression with deterministic output where exported |
| Mongoose ObjectId export cursor | PostgreSQL `export_id char(24)` generated as ObjectId-compatible lowercase hex from a monotonic source such as a sequence-backed value |
| `.select('-__v -origins')` | Explicit selected column list that excludes `origins`; merge any public JSONB payload fields back into the flat response shape before returning |
| `.sort({ lastReported: 1, _id: 1 })` | `orderBy(last_reported asc, export_id asc)` |
| Flexible nested Mongo fields | JSONB fields for payloads or snapshots that are not queried structurally |

## v3 item-improvement compatibility

The v3 item-improvement endpoints are the highest-risk compatibility surface.

PostgreSQL must preserve:

- Deterministic key generation for availability, cost, and update facts.
- Upsert semantics for first/last observed timestamps, first/last reported timestamps, sources,
  origins, observed flagship IDs, and count.
- Export limit clamping.
- Export filtering by `updatedAfter` and `afterId`.
- Export ordering by `(lastReported, _id)` semantics, implemented as `(last_reported, export_id)`.
- `next.updatedAfter` and `next.afterId` response fields.
- Omission of `origins` from export responses.

`export_id` must be unique and monotonic enough for cursor pagination. A random 24-character hex value
is not sufficient because rows inserted with the same `last_reported` timestamp and a lexicographically
lower ID could be skipped by `afterId`. Use a sequence-backed 24-character lowercase hex value, or an
equivalent deterministic monotonic generator, so `(last_reported, export_id)` pagination remains safe.

PostgreSQL exports must also account for MVCC commit visibility. Sequence-backed IDs can be allocated
in one order and commit in another, so a client can advance past an uncommitted row with the same
`last_reported` timestamp. Keep item-improvement writes as short single-statement transactions and
paginate only over a settled window, for example by excluding rows with `last_reported` newer than a
small cutoff captured once per request. The response cursor must be derived only from rows inside that
settled window. If implementation introduces longer export-affecting transactions, add a stricter
watermark strategy such as serialized export writes or database commit-timestamp tracking before
claiming no-drop export pagination.

## Testing strategy

Do not use PGlite as the only PostgreSQL validation layer.

Use:

- `mongodb-memory-server` for MongoDB e2e tests.
- A real PostgreSQL service in CI for PostgreSQL e2e tests.
- Optional PGlite only for fast local or repository-level tests where its behavior is sufficient.

PostgreSQL e2e tests must validate the production-like path:

- node-postgres driver and pooling.
- Drizzle schema and migrations.
- PostgreSQL arrays, plus JSONB fields used for nested array payloads.
- JSONB fields.
- BIGINT timestamp columns returning JSON numbers, not node-postgres `int8` strings.
- Conflict upserts.
- Export ordering and cursor behavior.
- Export pagination under concurrent inserts/upserts with same-millisecond timestamps.
- Startup/shutdown behavior.
- Connection/configuration errors.

The same HTTP behavior suite should run against both backends where possible.

Before implementation, define a test contract matrix that maps each endpoint to its required MongoDB
and PostgreSQL assertions:

| Area | Required parity coverage |
| --- | --- |
| Backend config | URI scheme selects MongoDB or PostgreSQL; unsupported schemes fail with redacted errors. |
| `/api/status` | Both backends return generic `database` counts and legacy `mongo` counts. |
| v2 append-only reports | Each report endpoint persists typed fields and preserves unknown future fields in JSONB on PostgreSQL. |
| v2 upserts | `select_rank`, `remodel_recipe`, `ship_stat`, and `enemy_info` match current count/min/max/update behavior. |
| v2 compatibility routes | `known_quests`, `known_recipes`, `quest/:id`, `remodel_recipe_deduplicate`, and `night_battle_ss_ci` keep current response behavior. |
| v3 quests | Quest and reward keys, uniqueness, known quest prefixes, and legacy `bounsCount` payload handling match MongoDB behavior. |
| v3 item-improvement ingest | Keys, normalization, `$setOnInsert` equivalents, min/max timestamps, set-union arrays, origins, and counts match MongoDB behavior. |
| v3 item-improvement export | Limit clamping, origin omission, numeric timestamps, cursor shape, ordering, settled-window pagination, and empty-page behavior match the API contract. |
| Monthly dumps and retention | Write-only tables can be dumped, verified, and cleaned up; stateful aggregate/fact tables are not emptied by the dump cleanup path. |
| Error handling | Malformed JSON, invalid payloads, invalid cursors, and database errors preserve current status/body behavior. |

Implementation is not complete until the parity matrix passes against MongoDB and a real PostgreSQL
service in CI. PGlite-only coverage is insufficient for accepting the PostgreSQL backend.

## Implementation phases

1. **Backend resolver and config**
   - Add `POI_SERVER_DATABASE_URL` while keeping `POI_SERVER_DB` as a backward-compatible fallback.
   - Select the backend solely from the resolved database URI scheme.
   - Redact MongoDB and PostgreSQL credentials in startup errors.
   - Update Sentry initialization so MongoDB integration is only used for the MongoDB backend, and
     PostgreSQL instrumentation is enabled only if the installed Sentry SDK supports the selected
     PostgreSQL driver. Request spans and captured database errors should still identify the active
     backend even without a PostgreSQL-specific integration.

2. **Mongo action split**
   - Move current Mongoose handler logic into Mongo-specific action modules.
   - Keep public behavior unchanged.
   - Keep existing MongoDB tests green.

3. **PostgreSQL dependency and schema**
   - Add Drizzle ORM, node-postgres, and migration tooling.
   - Define PostgreSQL tables, indexes, constraints, and migration scripts.
   - Define generated/canonical keys for `enemy_infos` and item-improvement export cursors before
     writing actions.
   - Define dumpable write-only tables, ingestion timestamps, partitioning strategy, and dump metadata
     tables before implementing monthly cleanup.

4. **PostgreSQL actions**
   - Implement PostgreSQL v2 actions.
   - Implement PostgreSQL v3 quest and quest reward actions.
   - Implement PostgreSQL v3 item-improvement ingestion and export actions.

5. **Dual-backend tests**
   - Parameterize e2e setup by backend.
   - Add CI PostgreSQL service.
   - Run MongoDB and PostgreSQL behavior suites.
   - Assert `/api/status` returns both generic `database` counts and legacy `mongo` counts.
   - Add retention tests proving only write-only dumped data is removed and stateful tables remain.

6. **Documentation and rollout**
   - Update `.env.example`, README, and deployment notes.
   - Document that the same codebase can run in MongoDB mode or PostgreSQL mode based on the
     configured database URI.
   - Deploy one machine in MongoDB mode and one machine in PostgreSQL mode.
   - Provision an empty PostgreSQL database and run migrations before sending production traffic to
     the PostgreSQL-mode server.
   - Switch production by changing traffic routing, not by mutating a single machine's database
     configuration in place.

## Adversarial review findings to guard against

- Do not rename `/api/status.mongo` as part of this migration; add a generic field but preserve the
  legacy one.
- Do not use random PostgreSQL export IDs for v3 item-improvement pagination; use monotonic IDs.
- Do not ignore PostgreSQL MVCC commit-order races in export pagination; use a settled export window
  before advancing cursors.
- Do not let node-postgres serialize millisecond BIGINT timestamps as strings in API responses; use
  Drizzle number mode or an explicit parser for `int8` fields that are safe JavaScript integers.
- Do not rely on PostgreSQL nested arrays for enemy fleet uniqueness. Store nested structures as JSONB
  and use a canonical hash for uniqueness.
- Do not model fallback as a single-machine database URI flip. Rollout uses two machines running the
  same server code in different database modes, and fallback is a traffic switch back to the MongoDB
  machine.
- Do not implement PostgreSQL as a loose raw SQL side path. Keep Drizzle schema, migrations, and typed
  actions as the maintainability boundary.
- Do not implement monthly cleanup as broad table truncation without classification. Only dumpable
  write-only tables may be emptied after a verified community dump; stateful aggregate/fact tables must
  remain available.

## Rollout and fallback

Rollout:

1. Release the same code to two machines.
2. Keep the existing production machine in MongoDB mode by configuring a MongoDB URI.
3. Configure the second machine with a PostgreSQL URI, provision an empty PostgreSQL database, and run
   migrations.
4. Validate the PostgreSQL-mode machine's health, status counts, migrations, and write/read behavior
   before routing production traffic to it.
5. Switch production traffic to the PostgreSQL-mode machine.
6. Monitor status counts, ingestion errors, and Sentry database spans after the traffic switch.

Fallback:

1. Switch traffic back to the MongoDB-mode machine.
2. Keep both machines' database configuration unchanged during fallback.

Because there is no data migration or dual-write requirement, fallback is an operational traffic
switch rather than a single-machine configuration rollback or data reconciliation process. Reports
accepted only by the PostgreSQL-mode machine after traffic is switched there are not expected to appear
in MongoDB after fallback.
