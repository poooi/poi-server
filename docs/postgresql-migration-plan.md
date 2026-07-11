# PostgreSQL migration plan

## Goals

Add PostgreSQL as a supported persistence backend while keeping MongoDB available. The active backend
is selected from the configured database URI scheme. Existing MongoDB data will not be migrated; a
PostgreSQL deployment starts with empty reporting tables. Production cutover to PostgreSQL is
irreversible at the application level: the old MongoDB deployment is not a rollback target after
PostgreSQL begins accepting production traffic.

Counts, Current State, Aggregates, Definitions, and Item-improvement Facts are not copied from
MongoDB. Traffic cutover remains an operational concern and is not persisted as application data.

## Non-goals

- Migrating existing MongoDB records into PostgreSQL.
- Removing MongoDB support.
- Implementing PostgreSQL backup automation in poi-server. Backup and restore are separate operational
  work.
- Making breaking report-ingestion or report-export HTTP API shape changes during the storage
  migration. `GET /api/status` is explicitly allowed to replace its storage-specific `mongo` field
  with a backend-neutral `database` field. Shared validation also turns declared-field cast failures
  into logged 400 responses, rejects fractional values for integral fields, and requires Domain
  Identity fields.

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

| URI scheme     | Backend    |
| -------------- | ---------- |
| `mongodb:`     | MongoDB    |
| `mongodb+srv:` | MongoDB    |
| `postgres:`    | PostgreSQL |
| `postgresql:`  | PostgreSQL |

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

This document is the implementation contract for the application migration. It defines every table,
column group, Domain Identity, retention rule, public compatibility exception, and required test area.
Implementation must follow the exact schema contract below rather than infer table shape from examples.

The separate PostgreSQL backup/restore plan remains an operational cutover prerequisite, not an
application implementation blocker. Production load-test results may tune pool size but must not
change API or persistence semantics without updating this contract.

Validation should be split by responsibility:

- Keep Zod schemas for public HTTP payload contracts and shared parsing behavior.
- Use Drizzle schema definitions as the source of truth for PostgreSQL table shape.
- Use `drizzle-zod` or equivalent schema derivation where it improves maintainability, but do not
  replace endpoint-specific validation rules that are stricter than table constraints.
- Do not add PostgreSQL-only report validation. Shared validation runs before backend selection so both
  action sets accept and reject the same values.
- Add shared validation for fields whose domain is integral and whose sampled production values are
  integral. Apply the same integer rules before both MongoDB and PostgreSQL actions so the backends do
  not diverge.
- Every value mapped to PostgreSQL `integer` or `integer[]` must be a signed 32-bit integer after
  shared casting. Every payload value mapped to numeric `bigint` must be a non-negative JavaScript safe
  integer. Reject out-of-range values with the same logged 400 response on both backends.
- Columns for historically optional or missing values must remain nullable unless tests demonstrate
  that both backends already reject the missing value.
- Identity fields for Current State, Aggregate, Definition, and Item-improvement Fact writes are the
  exception: validate them as required before either backend action and declare their PostgreSQL
  columns `NOT NULL`. Reject missing identity with the same logged 400 response on both backends.
- Required identity fields are:
  - Select Rank Current State: `teitokuId`, `mapareaId`.
  - Recipe Aggregate: `recipeId`, `itemId`, `stage`, `day`, `secretary`.
  - Ship Stat Aggregate: `id`, `lv`, `los`, `los_max`, `asw`, `asw_max`, `evasion`, `evasion_max`.
  - Enemy Info Aggregate: every canonical fleet field used to generate the identity hash, including
    `planes`.
  - Quest Definition: `title`, `detail`, `questId`, `category`.
  - Quest Reward Definition: `title`, `detail`, `questId`, `selections`, `bounsCount`.
  - Item-improvement Facts: the fields already required by the existing source-specific Zod schemas.
- The intentional payload changes in this migration are shared 400 responses for declared-field cast
  failures, integer validation for semantically integral fields, and required Domain Identity fields.
  Other missing legacy fields remain accepted.
- AACI is an explicit additional validation fix: require `poiVersion` to be valid semantic version
  text, and when `origin` starts with `Reporter ` require the suffix to be a valid semantic version.
  Invalid or missing versions return the same logged 400 on both backends instead of the current
  uncaught 500 path.
- Legacy shared normalization should preserve current Mongoose casting where it does not conflict with
  those tightenings:
  - Numeric fields accept finite numbers, numeric strings, and booleans using current Mongoose number
    casting; empty strings normalize to null. Integral fields then reject non-integer results.
  - String fields accept JSON scalar values and normalize them to strings; objects and arrays are
    rejected.
  - Boolean fields accept booleans, `0`, `1`, and the current Mongoose string set
    `true`/`false`/`yes`/`no`/`0`/`1`.
  - Mongoose array fields default missing input to an empty array, preserve explicit null, wrap a
    present scalar as a one-element array, and normalize each element.
  - Undeclared fields are discarded.
- Extend `AppRequest` with the narrow request-logger interface needed by shared handlers. When shared
  validation rejects a report, emit a structured warning event named `report_validation_rejected`.
- Include the endpoint and at most 20 validation issues with field path, issue code, expected type,
  received type, and the invalid scalar value. Truncate string values to 256 characters. Represent
  invalid objects and arrays only by type and size; never log the full rejected payload.
- Expected 4xx validation rejections should not be captured in Sentry.

## PostgreSQL ORM choice

Use Drizzle ORM with the node-postgres driver.

The initial backend targets PostgreSQL 18 as its sole production and CI database baseline. Supporting
older PostgreSQL majors is not part of this migration contract.

Drizzle is the preferred fit because it provides:

- TypeScript-first schema definitions.
- Readable query construction.
- PostgreSQL-native arrays, JSONB, indexes, and conflict handling.
- Migration tooling.
- Schema-driven validation support through companion tooling such as `drizzle-zod`.
- Raw SQL escape hatches for small PostgreSQL expressions while keeping most queries structured.

node-postgres remains the selected direct driver because it is the most widely adopted conventional
Node.js PostgreSQL driver, explicitly supports Node.js 24, has mature pool and PostgreSQL feature
documentation, and has first-class Sentry instrumentation. Drizzle supports both node-postgres and
Postgres.js, but Postgres.js's tagged-template ergonomics provide less benefit behind Drizzle.

Initial request-path pool configuration:

- `max: 10`, configurable through deployment configuration.
- `connectionTimeoutMillis: 5000`.
- `idleTimeoutMillis: 30000`.
- PostgreSQL request-path `statement_timeout` and `transaction_timeout`: 10 seconds.
- Item-improvement ingestion concurrency: 5, leaving pool capacity for unrelated requests.
- Migrations and offline Community Dump jobs use separate connections with task-specific longer
  timeouts and do not share the API pool.

These are safe initial limits, not permanent throughput claims. Load testing must reproduce at least
twice the measured peak second of 47 Observation writes before cutover and may justify a later pool
change.

Other options considered:

| Option             | Reason not chosen                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prisma             | Excellent generated client, but PostgreSQL-specific upsert details and array set-union updates are more awkward. Generated client lifecycle is also a larger shift for this service. |
| TypeORM            | Mature, but its entity/decorator lifecycle model is heavier than needed and less aligned with explicit backend actions.                                                              |
| Sequelize          | Runtime-model oriented and weaker TypeScript/schema ergonomics for a new TypeScript migration.                                                                                       |
| Kysely or raw `pg` | Good SQL control, but not an ORM in the desired sense and would require more hand-rolled schema/migration conventions.                                                               |

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
- `enemy_info` count increments plus current bomber range intersection behavior:
  `bombersMin` uses max/`greatest`, and `bombersMax` uses min/`least`.
- `aaci` persists only when the POI version is greater than `7.9.1`, the reporter origin starts with
  `Reporter `, and the reporter version is at least `3.6.0`.
- Legacy no-op routes remain no-ops, including `quest/:id` and `night_battle_ss_ci`.
- Preserve legacy route spelling, including `/api/report/v2/night_contcat`.
- v2 `known_quests` sort behavior.
- v3 quest and quest reward upserts by stable quest hash fields.
- v3 item-improvement ingestion, export filtering, export ordering, cursor behavior, and omission of
  reporter origins.

## Status endpoint

`GET /api/status` currently returns a `mongo` object containing model counts. The storage migration
will intentionally replace that field with a backend-neutral `database` object. Do not return a
misleading `mongo` alias while PostgreSQL is active. Keep the existing top-level `env` and `disk`
fields unchanged.

`database` should expose the active backend, health, and explicitly approximate row counts. Use
MongoDB's metadata-based estimated document counts and PostgreSQL's default catalog/planner row
estimates, summing leaf-partition estimates for partitioned Observation tables. Do not run exact
collection counts or PostgreSQL `count(*)` scans in the public status request.
Treat missing or negative PostgreSQL leaf estimates, including fresh `reltuples = -1`, as zero.

The estimates have no guaranteed error bound. With healthy default PostgreSQL statistics maintenance,
roughly ten-percent error is a useful expectation rather than a contract. These values are for
operational scale and trend visibility only; dump verification and cleanup must use exact exported row
counts and checksums.

The response shape is:

```ts
interface DatabaseStatus {
  backend: 'mongodb' | 'postgresql'
  status: 'up'
  estimatedCounts: {
    createShipObservations: number
    createItemObservations: number
    remodelItemObservations: number
    dropShipObservations: number
    passEventObservations: number
    battleApiObservations: number
    nightContactObservations: number
    aaciObservations: number
    nightBattleCiObservations: number
    selectRankStates: number
    recipeAggregates: number
    shipStatAggregates: number
    enemyInfoAggregates: number
    questDefinitions: number
    questRewardDefinitions: number
    itemImprovementAvailabilityFacts: number
    itemImprovementCostFacts: number
    itemImprovementUpdateFacts: number
  }
}
```

Both backends must populate all 18 keys.

## PostgreSQL schema outline

Use typed scalar columns for fields used in queries, uniqueness, and exports. Use PostgreSQL arrays
for primitive arrays and JSONB for flexible nested report payloads that are not queried structurally.
Use BIGINT for millisecond timestamps, but define Drizzle columns with number-mode parsing so JSON
responses keep the current numeric timestamp contract instead of returning node-postgres `int8`
strings.

A read-only production profile sampled up to 10,000 documents from every current collection. All
semantically integral declared fields in the sample were integral and within signed 32-bit range. The
only observed fractional declared fields were `night_battle_cis.damage`, which is an array, and
`night_battle_cis.damage_total`. Map numeric fields as follows:

- Use PostgreSQL `integer` and `integer[]` for semantically integral values covered by shared integer
  validation, including signed 32-bit range validation.
- Use `bigint` in Drizzle number mode for millisecond timestamps such as `last_reported`,
  `last_timestamp`, client observation timestamps, and `night_battle_cis.time`.
- Use `double precision` and `double precision[]` for `night_battle_cis.damage_total`,
  `night_battle_cis.damage`, and AACI `hp_percent`, which has no retained production sample and is
  semantically fractional.
- Keep arbitrary battle API data and declared nested structures in JSONB rather than inferring scalar
  types from numeric values nested inside them.

Use a hybrid schema so PostgreSQL keeps MongoDB's extensibility where the API depends on flexible
declared report payloads:

- Typed columns are required for fields used in lookups, uniqueness, ordering, aggregation, public
  exports, and status counts.
- Primitive arrays should use PostgreSQL arrays. Declared nested structures that are not queried
  structurally should use JSONB.
- Undeclared client fields should be discarded, matching current Mongoose and Zod behavior. Do not add
  a generic `raw_payload` or `extra` field solely to retain unknown input.
- Add compatible fields to the existing endpoint and table through an additive Drizzle migration,
  using nullable columns or behavior-safe defaults as appropriate.
- Introduce a new endpoint or table only when the new data has incompatible validation, identity, or
  aggregation semantics, or represents a distinct concept.
- Each PostgreSQL action must explicitly map validated report fields to declared columns rather than
  passing arbitrary request objects to Drizzle.
- If a stored record is returned by an API, select and shape public fields explicitly, omitting
  internal columns such as generated hashes and private fields like `origins` where the current API
  omits them.

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

These append-heavy tables contain write-only observations. They should be designed as dumpable
retention tables: the service writes them, monthly jobs publish their data to the community, and old
dumped observations can be removed from PostgreSQL to control disk usage.

Current State tables:

- `select_rank_records`

Aggregate tables:

- `recipe_records`
- `ship_stats`
- `enemy_infos`

Definition tables:

- `quests`
- `quest_rewards`

Item-improvement fact tables:

- `item_improvement_availability_facts`
- `item_improvement_cost_facts`
- `item_improvement_update_facts`

Current State, Aggregate, Definition, and Item-improvement Fact tables are stateful service data, not
write-only dump buffers. They may be included in community dumps as snapshots if useful, but they must
not be emptied as part of the Observation cleanup path.

## Exact PostgreSQL schema contract

Schema conventions:

- Database identifiers use `snake_case`; API and Community Dump fields retain their existing camelCase
  names.
- `text` is used for strings unless a generated key has an explicit format check.
- `integer` means signed 32-bit PostgreSQL integer.
- Millisecond timestamps and accumulated counts use `bigint`. Drizzle must use number mode only where
  values are checked to remain within JavaScript's safe-integer range.
- A nullable scalar payload column distinguishes a missing/null legacy field from a present value.
  Mongoose array columns are nullable for explicit null but default omitted input to an empty
  PostgreSQL array.
- JSONB columns contain only the declared nested value. They are not extension bags.
- Database-generated timestamps use PostgreSQL `clock_timestamp()`.

### Control tables

`data_dump_runs`:

| Column                | Type              | Contract                                                                                                   |
| --------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`                  | `bigint identity` | Primary key.                                                                                               |
| `dump_month`          | `date`            | Not null; first JST calendar date of the Dump Month.                                                       |
| `schema_version`      | `integer`         | Not null.                                                                                                  |
| `status`              | `text`            | Not null; one of `pending`, `exporting`, `uploaded`, `published`, `cleanup_eligible`, `cleaned`, `failed`. |
| `manifest_object_key` | `text`            | Nullable until upload.                                                                                     |
| `manifest_bytes`      | `bigint`          | Nullable until publication; non-negative.                                                                  |
| `manifest_sha256`     | `bytea`           | Nullable until publication; exactly 32 bytes.                                                              |
| `published_at`        | `timestamptz`     | Nullable.                                                                                                  |
| `cleanup_eligible_at` | `timestamptz`     | Nullable; exactly seven days after publication.                                                            |
| `cleaned_at`          | `timestamptz`     | Nullable.                                                                                                  |
| `error`               | `text`            | Nullable; last actionable failure.                                                                         |
| `created_at`          | `timestamptz`     | Not null, default `clock_timestamp()`.                                                                     |
| `updated_at`          | `timestamptz`     | Not null, default `clock_timestamp()` and updated on each state transition.                                |

Add a unique constraint on `dump_month`. Each Dump Month has one canonical immutable publication;
`schema_version` records its manifest/data format rather than creating a second publication identity.

`data_dump_files`:

| Column             | Type              | Contract                                                          |
| ------------------ | ----------------- | ----------------------------------------------------------------- |
| `id`               | `bigint identity` | Primary key.                                                      |
| `dump_run_id`      | `bigint`          | Not null; references `data_dump_runs(id)` with restricted delete. |
| `dataset`          | `text`            | Not null; one of the nine Observation dataset names.              |
| `partition_name`   | `text`            | Not null.                                                         |
| `object_key`       | `text`            | Not null.                                                         |
| `row_count`        | `bigint`          | Not null and non-negative.                                        |
| `compressed_bytes` | `bigint`          | Not null and non-negative.                                        |
| `sha256`           | `bytea`           | Not null; exactly 32 bytes.                                       |
| `verified_at`      | `timestamptz`     | Nullable until R2 verification.                                   |

Add a unique constraint on `(dump_run_id, dataset)`.

### Observation tables

Every Observation table is range-partitioned by `ingested_at` and starts with these columns:

| Column        | Type              | Contract                               |
| ------------- | ----------------- | -------------------------------------- |
| `id`          | `bigint identity` | Not null.                              |
| `ingested_at` | `timestamptz`     | Not null, default `clock_timestamp()`. |

The primary key is `(ingested_at, id)`. Scalar payload columns below are nullable to preserve legacy
missing fields. Array payload columns are nullable with an empty-array default, preserving current
Mongoose omitted-array behavior.

| Table                  | Declared payload columns                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_ship_records`  | `items integer[]`, `kdock_id integer`, `secretary integer`, `ship_id integer`, `highspeed integer`, `teitoku_lv integer`, `large_flag boolean`, `origin text`                                                                                                                                                                                                                                             |
| `create_item_records`  | `items integer[]`, `secretary integer`, `item_id integer`, `teitoku_lv integer`, `successful boolean`, `origin text`                                                                                                                                                                                                                                                                                      |
| `remodel_item_records` | `successful boolean`, `item_id integer`, `item_level integer`, `flagship_id integer`, `flagship_level integer`, `flagship_cond integer`, `consort_id integer`, `consort_level integer`, `consort_cond integer`, `teitoku_lv integer`, `certain boolean`                                                                                                                                                   |
| `drop_ship_records`    | `ship_id integer`, `item_id integer`, `map_id integer`, `quest text`, `cell_id integer`, `enemy text`, `rank text`, `is_boss boolean`, `teitoku_lv integer`, `map_lv integer`, `enemy_ships1 integer[]`, `enemy_ships2 integer[]`, `enemy_formation integer`, `base_exp integer`, `teitoku_id text`, `owned_ship_snapshot jsonb`, `origin text`                                                           |
| `pass_event_records`   | `teitoku_id text`, `teitoku_lv integer`, `map_id integer`, `map_lv integer`, `rewards jsonb DEFAULT '[]'`, `origin text`                                                                                                                                                                                                                                                                                  |
| `battle_apis`          | `origin text`, `path text`, `data jsonb`                                                                                                                                                                                                                                                                                                                                                                  |
| `night_contacts`       | `fleet_type integer`, `ship_id integer`, `ship_lv integer`, `item_id integer`, `item_lv integer`, `contact boolean`                                                                                                                                                                                                                                                                                       |
| `aaci_records`         | `poi_version text`, `available integer[]`, `triggered integer`, `items integer[]`, `improvement integer[]`, `raw_luck integer`, `raw_taiku integer`, `lv integer`, `hp_percent double precision`, `pos integer`, `origin text`                                                                                                                                                                            |
| `night_battle_cis`     | `ship_id integer`, `ci text`, `type text`, `lv integer`, `raw_luck integer`, `pos integer`, `status text`, `items integer[]`, `improvement integer[]`, `search_light boolean`, `flare integer`, `defense_id integer`, `defense_type_id integer`, `ci_type integer`, `display integer[]`, `hit_type integer[]`, `damage double precision[]`, `damage_total double precision`, `time bigint`, `origin text` |

Do not add `ship_counts` to `drop_ship_records`: it exists in a TypeScript interface but is absent
from the Mongoose schema and is currently discarded. Likewise, do not add `origin` to
`remodel_item_records` or `night_contacts`; their Mongoose schemas currently discard it.

### Current State, Aggregate, and Definition tables

`select_rank_records`:

| Column       | Type              | Contract                   |
| ------------ | ----------------- | -------------------------- |
| `id`         | `bigint identity` | Primary key.               |
| `teitoku_id` | `text`            | Not null; Domain Identity. |
| `maparea_id` | `integer`         | Not null; Domain Identity. |
| `teitoku_lv` | `integer`         | Nullable.                  |
| `rank`       | `integer`         | Nullable.                  |
| `origin`     | `text`            | Nullable.                  |

Unique `(teitoku_id, maparea_id)`. On conflict, replace `teitoku_lv`, `rank`, and `origin` with the
new Report values, preserving explicit nulls.

`recipe_records`:

| Column group            | Type and nullability                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary key             | `id bigint identity`                                                                                                                                                                   |
| Domain Identity         | `recipe_id integer NOT NULL`, `item_id integer NOT NULL`, `stage integer NOT NULL`, `day integer NOT NULL`, `secretary integer NOT NULL`                                               |
| Nullable integer values | `fuel`, `ammo`, `steel`, `bauxite`, `req_item_id`, `req_item_count`, `buildkit`, `remodelkit`, `certain_buildkit`, `certain_remodelkit`, `upgrade_to_item_id`, `upgrade_to_item_level` |
| Other values            | `key text NULL`, `origin text NULL`                                                                                                                                                    |
| Accumulation            | `last_reported bigint NOT NULL`, `count bigint NOT NULL DEFAULT 1`                                                                                                                     |

Unique `(recipe_id, item_id, stage, day, secretary)`. `stage === -1` remains a successful no-op.
Insert with `count = 1`; on conflict increment `count`, set `last_reported` from database time, and
update only non-identity fields present in the incoming Report. A missing field does not erase the
stored value; an explicit null does.

`ship_stats`:

| Column group    | Type and nullability                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary key     | `id bigint identity`                                                                                                                                                                                                  |
| Domain Identity | `ship_id integer NOT NULL`, `lv integer NOT NULL`, `los integer NOT NULL`, `los_max integer NOT NULL`, `asw integer NOT NULL`, `asw_max integer NOT NULL`, `evasion integer NOT NULL`, `evasion_max integer NOT NULL` |
| Accumulation    | `last_timestamp bigint NOT NULL`, `count bigint NOT NULL DEFAULT 1`                                                                                                                                                   |

Unique across the eight Domain Identity columns. Insert with `count = 1`; on conflict increment
`count` and replace `last_timestamp` with database time.

`enemy_infos`:

| Column group             | Type and nullability                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Primary key              | `id bigint identity`                                                                                               |
| Identity digest          | `identity_hash bytea NOT NULL`, exactly 32 bytes and unique                                                        |
| Required flat arrays     | `ships1 integer[]`, `levels1 integer[]`, `hp1 integer[]`, `ships2 integer[]`, `levels2 integer[]`, `hp2 integer[]` |
| Required nested arrays   | `stats1 jsonb`, `equips1 jsonb`, `stats2 jsonb`, `equips2 jsonb`                                                   |
| Required scalar identity | `planes integer`                                                                                                   |
| Accumulation             | `bombers_min integer NULL`, `bombers_max integer NULL`, `count bigint NOT NULL DEFAULT 1`                          |

All identity components are `NOT NULL`. Insert with `count = 1`. On conflict, verify component
equality, increment `count`, update `bombers_min` to the greater non-null value, and update
`bombers_max` using MongoDB's current BSON ordering semantics. Field presence matters:

- An absent bomber field leaves the stored bound unchanged.
- Numeric `bombersMin` applies `greatest`; explicit null leaves an existing numeric minimum unchanged
  and stores null only when there is no prior value.
- Numeric `bombersMax` applies `least`; explicit null replaces an existing numeric maximum with null.

Parity tests must execute these absent, explicit-null, and numeric transitions against MongoDB before
encoding the equivalent PostgreSQL expressions.

`quests`:

| Column     | Type              | Contract                                           |
| ---------- | ----------------- | -------------------------------------------------- |
| `id`       | `bigint identity` | Primary key.                                       |
| `key`      | `text`            | Not null; 32 lowercase hexadecimal MD5 characters. |
| `quest_id` | `integer`         | Not null.                                          |
| `title`    | `text`            | Not null.                                          |
| `detail`   | `text`            | Not null.                                          |
| `category` | `integer`         | Not null.                                          |
| `type`     | `integer`         | Nullable.                                          |
| `origin`   | `text`            | Nullable.                                          |

Unique `(key, quest_id, category)`. On conflict, verify `title` and `detail` match and otherwise do
nothing, preserving `$setOnInsert` behavior.

`quest_rewards`:

| Column        | Type              | Contract                                              |
| ------------- | ----------------- | ----------------------------------------------------- |
| `id`          | `bigint identity` | Primary key.                                          |
| `key`         | `text`            | Not null; 32 lowercase hexadecimal MD5 characters.    |
| `quest_id`    | `integer`         | Not null.                                             |
| `title`       | `text`            | Not null.                                             |
| `detail`      | `text`            | Not null.                                             |
| `category`    | `integer`         | Nullable.                                             |
| `type`        | `integer`         | Nullable.                                             |
| `origin`      | `text`            | Nullable.                                             |
| `selections`  | `integer[]`       | Not null.                                             |
| `material`    | `integer[]`       | Nullable, default empty array.                        |
| `bonus`       | `jsonb`           | Nullable, default JSON array `[]`.                    |
| `bonus_count` | `integer`         | Not null; parsed from legacy HTTP field `bounsCount`. |

Unique `(key, quest_id, selections, bonus_count)`. On conflict, verify `title` and `detail` match and
otherwise do nothing.

### Item-improvement Fact tables

Create one shared sequence, `item_improvement_fact_id_seq`. Every Fact table has:

| Column                     | Type        | Contract                                                                                                           |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                       | `bigint`    | Primary key, default `nextval('item_improvement_fact_id_seq')`.                                                    |
| `export_id`                | `text`      | Stored generated value `lpad(to_hex(id), 24, '0')`; unique and constrained to 24 lowercase hexadecimal characters. |
| `key`                      | `text`      | Not null and unique.                                                                                               |
| `schema_version`           | `integer`   | Not null.                                                                                                          |
| `recipe_id`                | `integer`   | Not null.                                                                                                          |
| `item_id`                  | `integer`   | Not null.                                                                                                          |
| `day`                      | `integer`   | Not null.                                                                                                          |
| `first_client_observed_at` | `bigint`    | Not null.                                                                                                          |
| `last_client_observed_at`  | `bigint`    | Not null.                                                                                                          |
| `observed_second_ship_id`  | `integer`   | Not null.                                                                                                          |
| `observed_flagship_ids`    | `integer[]` | Not null, default empty array.                                                                                     |
| `sources`                  | `text[]`    | Not null, default empty array.                                                                                     |
| `origins`                  | `text[]`    | Not null, default empty array; private in exports.                                                                 |
| `first_reported`           | `bigint`    | Not null.                                                                                                          |
| `last_reported`            | `bigint`    | Not null.                                                                                                          |
| `count`                    | `bigint`    | Not null, default `1`.                                                                                             |

`item_improvement_availability_facts` adds no other columns.

`item_improvement_cost_facts` adds these `NOT NULL` columns:

- `item_level integer`
- `stage integer`
- `fuel integer`
- `ammo integer`
- `steel integer`
- `bauxite integer`
- `buildkit integer`
- `remodelkit integer`
- `certain_buildkit integer`
- `certain_remodelkit integer`
- `req_slot_items jsonb`
- `req_use_items jsonb`
- `change_flag integer`

`item_improvement_update_facts` adds these `NOT NULL` columns:

- `item_level integer`
- `upgrade_to_item_id integer`
- `upgrade_to_item_level integer`
- `upgrade_observed boolean DEFAULT true`

Fact upserts keep insert-only stable fields unchanged; use least/greatest for first/last timestamps;
perform stable append-if-absent union for `sources`, `origins`, and `observed_flagship_ids`; and
increment `count`. Existing array order is preserved and newly observed values are appended in incoming
order, matching MongoDB `$addToSet`/`$each`. All three Fact tables have
`(last_reported, export_id)` indexes plus the source-specific lookup indexes listed below.

## Community data dumps and retention

PostgreSQL design must support monthly community data dumps and disk-space reclamation.

Dump policy:

- Dump write-only append-heavy report tables monthly after the month has closed.
- Publish each Observation table as one Zstandard-compressed JSON Lines file per Dump Month.
- Keep files separated by logical dataset; never mix different Observation kinds in one data file.
- Serialize each line using the backend-neutral camelCase report field names, plus `observationId` as
  a decimal string and `ingestedAt` as an ISO-8601 UTC timestamp. Omit MongoDB `_id`/`__v` and
  PostgreSQL-only partition, hash, and storage columns.
- Publish a JSON manifest for each Dump Month containing the dump schema version and, for every file,
  its table name, row count, compressed byte size, and SHA-256 digest.
- Treat JSON Lines plus its manifest as the canonical community format. Derived formats such as
  Parquet may be added later but are not required for retention cleanup.
- Publish into the same Cloudflare R2 bucket already used by the MongoDB VM's offline publishing
  script. Use immutable, versioned object keys; upload the manifest only after all referenced data
  objects are present and verified, and treat the manifest URL as the publication commit point.
- After a dump is successfully published and verified, remove the dumped write-only records from
  PostgreSQL.
- Do not empty Current State, Aggregate, Definition, or Item-improvement Fact tables as part of
  Observation retention cleanup.

Use object keys:

```text
{YYYY-MM}/{dataset}.jsonl.zst
{YYYY-MM}/manifest.json
```

Manifest schema version 1:

```ts
interface CommunityDumpManifestV1 {
  schemaVersion: 1
  dumpMonth: string // YYYY-MM in Asia/Tokyo
  timezone: 'Asia/Tokyo'
  publishedAt: string
  files: Array<{
    dataset:
      | 'createShipObservations'
      | 'createItemObservations'
      | 'remodelItemObservations'
      | 'dropShipObservations'
      | 'passEventObservations'
      | 'battleApiObservations'
      | 'nightContactObservations'
      | 'aaciObservations'
      | 'nightBattleCiObservations'
    objectKey: string
    rowCount: string
    compressedBytes: string
    sha256: string
  }>
}
```

`rowCount` and `compressedBytes` are decimal strings so consumers do not lose 64-bit precision.
`sha256` is 64 lowercase hexadecimal characters over the exact compressed object bytes.

Community Dump record schema version 1 uses these JSON keys in this exact order:

| Dataset                     | Ordered keys after `observationId`, `ingestedAt`                                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createShipObservations`    | `items`, `kdockId`, `secretary`, `shipId`, `highspeed`, `teitokuLv`, `largeFlag`, `origin`                                                                                                                        |
| `createItemObservations`    | `items`, `secretary`, `itemId`, `teitokuLv`, `successful`, `origin`                                                                                                                                               |
| `remodelItemObservations`   | `successful`, `itemId`, `itemLevel`, `flagshipId`, `flagshipLevel`, `flagshipCond`, `consortId`, `consortLevel`, `consortCond`, `teitokuLv`, `certain`                                                            |
| `dropShipObservations`      | `shipId`, `itemId`, `mapId`, `quest`, `cellId`, `enemy`, `rank`, `isBoss`, `teitokuLv`, `mapLv`, `enemyShips1`, `enemyShips2`, `enemyFormation`, `baseExp`, `teitokuId`, `ownedShipSnapshot`, `origin`            |
| `passEventObservations`     | `teitokuId`, `teitokuLv`, `mapId`, `mapLv`, `rewards`, `origin`                                                                                                                                                   |
| `battleApiObservations`     | `origin`, `path`, `data`                                                                                                                                                                                          |
| `nightContactObservations`  | `fleetType`, `shipId`, `shipLv`, `itemId`, `itemLv`, `contact`                                                                                                                                                    |
| `aaciObservations`          | `poiVersion`, `available`, `triggered`, `items`, `improvement`, `rawLuck`, `rawTaiku`, `lv`, `hpPercent`, `pos`, `origin`                                                                                         |
| `nightBattleCiObservations` | `shipId`, `CI`, `type`, `lv`, `rawLuck`, `pos`, `status`, `items`, `improvement`, `searchLight`, `flare`, `defenseId`, `defenseTypeId`, `ciType`, `display`, `hitType`, `damage`, `damageTotal`, `time`, `origin` |

Serialization rules:

- Emit every listed key. SQL null, including a legacy missing scalar, serializes as JSON `null`.
- Omitted Mongoose arrays normally persist and serialize as `[]`; explicit null serializes as `null`.
- `observationId` is the decimal-string `id`; `ingestedAt` is UTC ISO-8601 with millisecond precision.
- Serialize JSONB values with recursive lexicographic object-key ordering. Preserve array order.
- Reject non-finite numbers before persistence; JSONL contains only standard finite JSON numbers.
- Encode UTF-8 without a byte-order mark, with one compact JSON object and one LF per record.
- Compress with a standard Zstandard frame at level 9, content checksum enabled, and no dictionary.
  Compressor upgrades may change bytes but not the versioned JSON record schema; each published
  object's own digest remains authoritative.

Schema requirements for dumpable write-only tables:

- Add a per-table `bigint GENERATED ALWAYS AS IDENTITY` internal `id`.
- Add an internal ingestion timestamp such as `ingested_at` to every write-only report table, even if
  the current MongoDB schema did not record one. This timestamp is for dump partitioning and retention,
  not part of the public API contract.
- Define each partitioned Observation table's primary key as `(ingested_at, id)`. Use that pair for
  deterministic dump ordering; do not expose the internal ID through report HTTP responses.
- Store `ingested_at` as `timestamptz`. Assign observations to Dump Months using Japan Standard Time
  calendar boundaries, expressed as exact UTC instants in partition definitions.
- Range-partition every Observation table monthly by `ingested_at` so cleanup has one uniform
  partition-drop path and never needs broad row-by-row deletion.
- Create upcoming Dump Month partitions before their boundary. Keep a default partition only as an
  alertable ingestion safety net; rows in it indicate partition maintenance failure, and it must never
  be included in automated cleanup.
- Add an idempotent offline partition-repair command. For one parent table and Dump Month it takes an
  advisory and table lock, creates a standalone staging table with the exact month-bound check, moves
  only matching rows from the default partition into it, attaches that table as the monthly partition,
  verifies source/destination counts, and commits. This order avoids PostgreSQL rejecting partition
  creation while matching rows remain in the default partition. Publication remains blocked until all
  nine default partitions contain no rows for the target month.
- Keep typed columns for scalar and primitive-array fields. Use JSONB only for declared nested
  structures that do not need relational querying.
- Keep dump metadata in a small control table, for example `data_dump_runs`, recording dump month,
  table or partition name, row count, checksum or manifest hash, output location, completion time, and
  cleanup time.

Dump workflow:

1. Refuse to start if the default partition contains rows belonging to the target Dump Month.
2. Select the nine closed monthly Observation partitions in a repeatable-read transaction.
3. Stream rows ordered by `(ingested_at, id)` into the versioned camelCase JSONL serializers, compress
   with Zstandard, and calculate row count, compressed bytes, and SHA-256 while streaming.
4. Compare the streamed row count with an exact count of each closed partition and persist the file
   metadata in `data_dump_files`.
5. Upload each data object with create-only conditional semantics, read it back from R2, and verify
   exact compressed byte count and SHA-256.
6. Construct a manifest containing exactly the nine expected dataset entries, persist its byte count
   and SHA-256 in `data_dump_runs`, upload it with create-only semantics, then read it back and verify
   the exact bytes. The verified manifest upload is the publication commit.
7. Mark the Dump Month published and start a seven-day cleanup grace period.
8. After the grace period, re-verify the manifest digest and size, require its dataset set and every
   entry to match `data_dump_files`, and re-verify every referenced object. Any missing object,
   digest mismatch, size mismatch, or row-count mismatch blocks cleanup and requires operator action.
9. Query PostgreSQL catalogs to prove every recorded partition belongs to the expected Observation
   parent and has the exact JST lower/upper bounds for the Dump Month.
10. Detach/drop only those nine verified partitions in a transaction, then mark the run cleaned.

The implementation must add separate idempotent offline commands for publish and cleanup. The publish
command may resume a failed run but must never overwrite a committed manifest. The cleanup command
must require one exact `data_dump_runs.id`, verify that run's Dump Month, schema version,
manifest object key, manifest digest, and published/eligible state, and refuse wildcard or broad-table
cleanup.

Important indexes and constraints:

- Unique `key` on item-improvement fact tables.
- `(last_reported, export_id)` index on item-improvement fact tables for export pagination.
- Lookup indexes equivalent to existing Mongoose item-improvement indexes:
  - availability: `(item_id, observed_second_ship_id, day)`, `recipe_id`
  - costs: `(item_id, observed_second_ship_id, day, item_level)`, `recipe_id`
  - updates: `(item_id, observed_second_ship_id, day, item_level)`, `recipe_id`, `upgrade_to_item_id`
- Unique upsert keys for tables that currently emulate uniqueness through query/update patterns.

Concrete PostgreSQL upsert keys:

| Table                  | Upsert/uniqueness key                                                                                                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `select_rank_records`  | `(teitoku_id, maparea_id)`                                                                                                                                                                                                                                            |
| `recipe_records`       | `(recipe_id, item_id, stage, day, secretary)`                                                                                                                                                                                                                         |
| `ship_stats`           | `(ship_id, lv, los, los_max, asw, asw_max, evasion, evasion_max)`                                                                                                                                                                                                     |
| `enemy_infos`          | SHA-256 of an ordered JSON tuple containing `ships1`, `levels1`, `hp1`, `stats1`, `equips1`, `ships2`, `levels2`, `hp2`, `stats2`, `equips2`, and `planes`.                                                                                                           |
| `quests`               | `(key, quest_id, category)`                                                                                                                                                                                                                                           |
| `quest_rewards`        | `(key, quest_id, selections, bonus_count)` using PostgreSQL's native equality support for primitive array columns. The PostgreSQL column should use the corrected `bonus_count` name while the HTTP payload parser continues accepting the legacy `bounsCount` field. |
| item-improvement facts | `key`                                                                                                                                                                                                                                                                 |

These tuples are Domain Identities, not migration identifiers. Enforce each Domain Identity with a
unique constraint so concurrent writes use one atomic `INSERT ... ON CONFLICT ... DO UPDATE` path
instead of a read-then-write race.

Use a `bigint GENERATED ALWAYS AS IDENTITY` surrogate primary key for Current State, Aggregate, and
Definition tables, with Domain Identity enforced separately. Wide natural tuples remain unique but do
not become primary keys. Item-improvement Fact tables use the shared sequence value as their bigint
primary key and derive immutable `export_id` from it.

The legacy `remodel_recipe_deduplicate` endpoint should remain available. For PostgreSQL it should
normally return an empty deletion list because the unique key prevents new duplicates; existing
MongoDB duplicate cleanup remains Mongo-specific.

Enemy Info identity hashing must exactly preserve MongoDB's current equality semantics:

- Shared validation requires all eleven identity components.
- Serialize them as one ordered JSON array in the order listed above. Preserve every array and nested
  array element order; do not sort fleet values.
- Hash the UTF-8 serialization with SHA-256 and store the 32-byte digest in a unique `bytea` column.
- Retain the original identity components in their declared columns.
- On hash conflict, verify that every retained component equals the incoming component before applying
  the bomber-range and count update. A mismatch is a collision error and must not merge the rows.

## Semantic mapping

| Current MongoDB semantic                                   | PostgreSQL/Drizzle design                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `new Model(info).save()`                                   | Validate and map declared fields explicitly, discard undeclared fields, and insert typed/declared JSONB columns                         |
| status `count()`                                           | MongoDB metadata estimate or PostgreSQL catalog estimate; exact counts are reserved for offline dump verification                       |
| `distinct('questId')`                                      | A Drizzle distinct projection such as `selectDistinct({ questId: table.questId }).from(table)`; preserve current endpoint sort behavior |
| `findOne` then mutate/save for select rank                 | Unique key on `(teitoku_id, maparea_id)` with conflict update                                                                           |
| `$setOnInsert`                                             | Conflict update with immutable insert-only fields omitted from the update set                                                           |
| `$inc`                                                     | `count = table.count + 1`                                                                                                               |
| `$min`                                                     | `first_client_observed_at = least(existing, excluded)`                                                                                  |
| `$max`                                                     | `last_reported = greatest(existing, excluded)` and same for client observed timestamp                                                   |
| `$addToSet` scalar or `$each` arrays                       | PostgreSQL stable append-if-absent union that preserves existing order                                                                  |
| Mongoose ObjectId export cursor                            | Shared-sequence bigint encoded as a stored 24-character lowercase hexadecimal `export_id`                                               |
| `.select('-__v -origins')`                                 | Explicit selected column list that excludes `origins` and maps internal `export_id` to public `_id`                                     |
| `.sort({ lastReported: 1, _id: 1 })`                       | `orderBy(last_reported asc, export_id asc)`                                                                                             |
| Flexible nested Mongo fields                               | JSONB fields for payloads or snapshots that are not queried structurally                                                                |
| `EnemyInfo` `$max: { bombersMin }`, `$min: { bombersMax }` | Presence-aware PostgreSQL expressions that reproduce the tested MongoDB numeric/null transitions                                        |

## v3 item-improvement compatibility

The v3 item-improvement endpoints are the highest-risk compatibility surface.

PostgreSQL must preserve:

- Deterministic key generation for availability, cost, and update facts.
- Upsert semantics for first/last observed timestamps, first/last reported timestamps, sources,
  origins, observed flagship IDs, and count.
- Export limit clamping.
- Export filtering by `updatedAfter` and `afterId`.
- Export ordering by `(lastReported, _id)` semantics, implemented as `(last_reported, export_id)`.
- Public exported records must keep the current MongoDB `_id` field. PostgreSQL should derive `_id`
  from `export_id` as a 24-character lowercase hex string in response objects; `export_id` must remain
  an internal column and must not replace `_id` in the API response.
- `next.updatedAfter` and `next.afterId` response fields.
- Omission of `origins` from export responses.

Cursor parsing remains compatible with Mongoose 5 ObjectId behavior:

- Accept 24-character hexadecimal strings in either case and canonicalize them to lowercase.
- Accept 12-character strings only when every UTF-16 code unit is at most `0xff`, and canonicalize
  those 12 byte values to 24 lowercase hexadecimal characters. This includes the practical
  Mongoose-compatible ASCII/Latin-1 cursor case.
- Reject 12-character strings containing wider Unicode code units. Mongoose 5 reports them as valid
  but produces malformed `undefined...` hexadecimal output, so the shared 400 is an intentional bug
  fix rather than behavior to reproduce.
- Reject every other shape with the existing `afterId: must be a valid ObjectId` error.
- Compare only the canonicalized 24-character value with `export_id`.

The export response shape is:

```ts
interface ItemImprovementExportResponse<TRecord> {
  records: TRecord[]
  next: null | {
    updatedAfter: number
    afterId: string
  }
}
```

`export_id` must be unique and monotonic enough for cursor pagination. A random 24-character hex value
is not sufficient because rows inserted with the same `last_reported` timestamp and a lexicographically
lower ID could be skipped by `afterId`. Use one PostgreSQL sequence shared by all three
item-improvement Fact tables. Generate each immutable `export_id` by encoding the sequence value as
lowercase hexadecimal and left-padding it to 24 characters. This preserves cross-Fact-kind uniqueness
and deterministic lexical ordering.

PostgreSQL exports must also account for MVCC commit visibility. Sequence-backed IDs can be allocated
in one order and commit in another, so a client can advance past an uncommitted row with the same
`last_reported` timestamp. PostgreSQL item-improvement actions must:

- Keep each Fact write to one database statement and one transaction.
- Generate `last_reported` from PostgreSQL time inside that write rather than from an application
  timestamp captured before the statement begins.
- Apply a 10-second PostgreSQL `transaction_timeout` to item-improvement writes.
- Capture one export cutoff from PostgreSQL `clock_timestamp()` in a one-row CTE inside the export
  query and exclude rows newer than 30 seconds before that database cutoff. Do not use application
  time for the settled boundary.
- Derive the response cursor only from rows inside that settled window.

The 30-second settled window is part of the export contract and creates a bounded publication delay.
It does not affect Observation partitioning or monthly Community Dumps. If future implementation
allows an export-affecting transaction to exceed the 10-second bound, it must introduce a stricter
watermark mechanism before retaining the no-late-commit pagination claim.

The settled window is PostgreSQL-specific. MongoDB exports retain their current immediate visibility;
shared export tests cover response shape, filters, cursors, and ordering, while the 30-second
visibility-delay assertions run only against PostgreSQL.

## Testing strategy

Do not use PGlite as the only PostgreSQL validation layer.

Use:

- `mongodb-memory-server` for MongoDB e2e tests.
- A real PostgreSQL service in CI for PostgreSQL e2e tests.
- Optional PGlite only for fast local or repository-level tests where its behavior is sufficient.

PostgreSQL e2e tests must validate the production-like path:

- PostgreSQL 18.
- node-postgres driver and pooling.
- Drizzle schema and migrations.
- PostgreSQL arrays, plus JSONB fields used for nested array payloads.
- JSONB fields.
- BIGINT timestamp columns returning JSON numbers, not node-postgres `int8` strings.
- Conflict upserts.
- Export ordering and cursor behavior.
- Export pagination under concurrent inserts/upserts with same-millisecond timestamps.
- Enforcement of the 10-second item-improvement transaction bound and exclusion of Facts inside the
  30-second settled export window.
- Startup/shutdown behavior.
- Connection/configuration errors.

Preflight load acceptance on the target PostgreSQL VM:

- Run at least 100 report writes per second for 15 minutes against the disposable preflight database,
  using the measured Observation mix where available and including Current State/Aggregate conflicts.
- During that run, submit at least two simultaneous 100-record item-improvement batches.
- Require zero unexpected 5xx responses, connection-acquisition failures, statement timeouts, deadlocks,
  or lost writes.
- Require local-network response latency below 500 ms at p95 and below 2 seconds at p99.
- Record pool wait time, active/idle/waiting clients, PostgreSQL CPU, storage latency, lock waits, and
  statement latency. Any sustained pool queue or resource saturation blocks cutover and triggers a
  documented pool/query retest rather than an unreviewed configuration increase.

The same HTTP behavior suite should run against both backends where possible.

The test contract matrix maps behavior to required MongoDB and PostgreSQL assertions:

| Area                        | Required parity coverage                                                                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend config              | URI scheme selects MongoDB or PostgreSQL; unsupported schemes fail with redacted errors.                                                                                                                                                                              |
| `/api/status`               | Both backends return the same backend-neutral `database` shape; the legacy `mongo` field is absent.                                                                                                                                                                   |
| v2 observations             | Each report endpoint persists the declared fields and discards undeclared fields consistently on both backends.                                                                                                                                                       |
| v2 upserts                  | `select_rank`, `remodel_recipe`, `ship_stat`, and `enemy_info` match current update behavior, including Enemy Info absent/null/numeric bomber transitions.                                                                                                            |
| v2 compatibility routes     | `known_quests`, `known_recipes`, `quest/:id`, `remodel_recipe_deduplicate`, and `night_battle_ss_ci` keep current response behavior.                                                                                                                                  |
| v3 quests                   | Quest and reward keys, uniqueness, known quest prefixes, and legacy `bounsCount` payload handling match MongoDB behavior.                                                                                                                                             |
| v3 item-improvement ingest  | Keys, normalization, `$setOnInsert` equivalents, min/max timestamps, stable append-if-absent arrays, origins, and counts match MongoDB behavior.                                                                                                                      |
| v3 item-improvement export  | Both backends cover limit clamping, origin omission, numeric timestamps, public `_id`, cursor canonicalization, ordering, and empty pages; PostgreSQL additionally covers database-time settled pagination.                                                           |
| Monthly dumps and retention | All nine versioned JSONL serializers, manifest/object read-back verification, default-partition repair, grace period, catalog-bound partition verification, and cleanup classifications pass.                                                                         |
| Error handling              | Malformed JSON, invalid payloads, invalid cursors, and database errors preserve current status/body behavior.                                                                                                                                                         |
| Shared validation           | Both backends preserve documented Mongoose casting/defaults, enforce int32/safe-bigint ranges, reject cast failures, missing Domain Identity, invalid AACI semver, or fractional integral fields with the same 400 body, and emit bounded structured validation logs. |

Endpoint-level required cases:

| Endpoint                                                   | Required behavior assertions on both backends                                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/report/v2/create_ship`                          | Declared fields persist once; omitted arrays become empty; unknown fields are discarded.                                                                                      |
| `POST /api/report/v2/create_item`                          | Declared fields persist once with shared casting and integer validation.                                                                                                      |
| `POST /api/report/v2/remodel_item`                         | Declared fields persist once; injected `origin` is discarded because it is not in the legacy schema.                                                                          |
| `POST /api/report/v2/drop_ship`                            | `ownedShipSnapshot` becomes `{}` for `mapId < 73`; otherwise declared JSON is retained.                                                                                       |
| `POST /api/report/v2/select_rank`                          | Repeated Domain Identity replaces current level/rank/origin and does not add a second row.                                                                                    |
| `POST /api/report/v2/pass_event`                           | Declared reward objects persist in order; omitted rewards normalize to an empty array.                                                                                        |
| `GET /api/report/v2/known_quests`                          | Returns distinct quest IDs with the current JavaScript default sort behavior and Cloudflare cache headers.                                                                    |
| `POST /api/report/v2/quest/:id`                            | Returns 200 and performs no write.                                                                                                                                            |
| `POST /api/report/v2/battle_api`                           | Declared `path`, `origin`, and arbitrary JSON `data` persist; unknown top-level fields are discarded.                                                                         |
| `POST /api/report/v2/night_contcat`                        | Misspelled route remains registered; declared fields persist; injected `origin` is discarded.                                                                                 |
| `POST /api/report/v2/aaci`                                 | Invalid/missing semantic versions return logged 400; writes only when all current POI/reporter version gates pass; all other valid reports return 200 without a write.        |
| `GET /api/report/v2/known_recipes`                         | Returns `{ recipes: [] }`.                                                                                                                                                    |
| `POST /api/report/v2/remodel_recipe`                       | `stage === -1` is a no-op; otherwise insert/count/update semantics follow the exact Aggregate contract.                                                                       |
| `POST /api/report/v2/remodel_recipe_deduplicate`           | MongoDB removes legacy duplicates; PostgreSQL normally returns an empty deletion list because Domain Identity is unique.                                                      |
| `POST /api/report/v2/night_battle_ci`                      | Fractional `damage` and `damageTotal` round-trip; millisecond `time` remains a JSON number.                                                                                   |
| `POST /api/report/v2/night_battle_ss_ci`                   | Returns 200 and performs no write.                                                                                                                                            |
| `POST /api/report/v2/ship_stat`                            | Domain Identity inserts once, then atomically increments count and advances `last_timestamp`.                                                                                 |
| `POST /api/report/v2/enemy_info`                           | Ordered identity hashing matches Mongo tuple equality; count increments; min/max null and intersection rules match.                                                           |
| `POST /api/report/v3/item_improvement_recipe`              | Single and batch forms normalize identically; maximum batch 100; partial-write behavior on database failure matches the current per-record writes; response count is correct. |
| `GET /api/report/v3/item_improvement_recipes/availability` | Filters, clamp, public `_id`, cursor, omission of origins, and cache headers match; PostgreSQL alone applies the settled window.                                              |
| `GET /api/report/v3/item_improvement_recipes/costs`        | Same backend-aware export contract plus required-item JSON round-trip and stable arrays.                                                                                      |
| `GET /api/report/v3/item_improvement_recipes/updates`      | Same backend-aware export contract plus upgrade fields.                                                                                                                       |
| `GET /api/report/v3/known_quests`                          | Returns distinct eight-character quest-key prefixes with Cloudflare cache headers.                                                                                            |
| `POST /api/report/v3/quest`                                | Every quest in the Report uses MD5 title/detail keying and insert-only Definition semantics.                                                                                  |
| `POST /api/report/v3/quest_reward`                         | Accepts legacy `bounsCount`, stores `bonus_count`, preserves material/bonus structures, and inserts only once per Domain Identity.                                            |
| `GET /api/status`                                          | Returns `env`, `disk`, and the exact backend-neutral `database` shape with all 18 estimated counts.                                                                           |

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

2. **Shared contracts**
   - Add shared payload normalization, int32/safe-bigint validation, Domain Identity requirements,
     AACI semver validation, and bounded validation logging.
   - Add the backend-neutral `/api/status.database` response schema.
   - Add shared item-improvement cursor canonicalization and export response schemas.

3. **Mongo action split**
   - Move current Mongoose handler logic into Mongo-specific action modules.
   - Preserve MongoDB persistence behavior except for the explicitly documented shared validation,
     status response changes.
   - Keep existing MongoDB tests green.

4. **PostgreSQL dependency and schema**
   - Add Drizzle ORM, node-postgres, and migration tooling.
   - Define PostgreSQL tables, indexes, constraints, and migration scripts.
   - Expose migrations as an explicit deployment command; application startup must never apply
     migrations automatically.
   - Record the expected schema version in the application and fail startup with an actionable error
     when the PostgreSQL database is behind or otherwise incompatible.
   - Define generated/canonical keys for `enemy_infos` and item-improvement export cursors before
     writing actions.
   - Define dumpable write-only tables, ingestion timestamps, partitioning strategy, and dump metadata
     tables before implementing monthly cleanup.

5. **PostgreSQL actions**
   - Implement PostgreSQL v2 actions.
   - Implement PostgreSQL v3 quest and quest reward actions.
   - Implement PostgreSQL v3 item-improvement ingestion and export actions.

6. **Dual-backend tests**
   - Parameterize e2e setup by backend.
   - Add CI PostgreSQL service.
   - Run MongoDB and PostgreSQL behavior suites.
   - Assert `/api/status` returns the same backend-neutral `database` shape for both backends and does
     not return the legacy `mongo` field.
   - Add retention tests proving only write-only dumped data is removed and stateful tables remain.

7. **Community Dump tools**
   - Implement versioned JSONL serializers, Zstandard streaming, metadata state transitions, immutable
     R2 publication, partition repair, and cleanup as offline commands.
   - Test publish retry, R2 verification failure, grace-period refusal, catalog mismatch refusal, and
     successful nine-partition cleanup.

8. **Documentation and rollout**
   - Update `.env.example`, README, and deployment notes.
   - Document that the same codebase can run in MongoDB mode or PostgreSQL mode based on the
     configured database URI.
   - Deploy one machine in MongoDB mode and one machine in PostgreSQL mode.
   - Provision an empty PostgreSQL database and run migrations before sending production traffic to
     the PostgreSQL-mode server.
   - Switch production by changing traffic routing, not by mutating a single machine's database
     configuration in place.
   - Treat the cutover as irreversible at the application level. Recover or repair PostgreSQL after a
     post-cutover incident instead of routing traffic back to stale MongoDB state.

## Adversarial review findings to guard against

- Do not retain a misleading `/api/status.mongo` alias. Replace it with the agreed backend-neutral
  `database` field for both backends.
- Do not use random PostgreSQL export IDs for v3 item-improvement pagination; use monotonic IDs.
- Do not ignore PostgreSQL MVCC commit-order races in export pagination; use a settled export window
  before advancing cursors.
- Do not let node-postgres serialize millisecond BIGINT timestamps as strings in API responses; use
  Drizzle number mode or an explicit parser for `int8` fields that are safe JavaScript integers.
- Do not rely on PostgreSQL nested arrays for enemy fleet uniqueness. Store nested structures as JSONB
  and use a canonical hash for uniqueness.
- Do not treat the old MongoDB machine as a post-cutover fallback. After PostgreSQL accepts production
  traffic, recovery must preserve PostgreSQL as the authoritative backend.
- Do not implement PostgreSQL as a loose raw SQL side path. Keep Drizzle schema, migrations, and typed
  actions as the maintainability boundary.
- Do not implement monthly cleanup as broad table truncation without classification. Only dumpable
  Observation tables may be emptied after a verified community dump; Current State, Aggregate,
  Definition, and Item-improvement Fact tables must remain available.

## Rollout and recovery

Rollout:

1. Release the same code to two machines.
2. Keep the existing production machine in MongoDB mode by configuring a MongoDB URI.
3. On the PostgreSQL machine, provision a disposable preflight database, run migrations, and run the
   full PostgreSQL HTTP behavior and load tests against it.
4. Destroy the preflight database after successful validation.
5. Provision a fresh empty production database and run migrations as an explicit deployment step.
6. Start poi-server and verify startup/schema/status health without synthetic production writes.
7. Switch production traffic to the PostgreSQL-mode machine without a report-write maintenance window.
8. Monitor estimated counts, validation/database errors, pool saturation, and Sentry database spans
   after the traffic switch.

After step 7, PostgreSQL is authoritative and the cutover is irreversible at the application level.
The old MongoDB machine must not receive production traffic as a rollback mechanism because it does not
contain reports accepted after cutover. PostgreSQL incidents must be handled through repair,
replacement, or PostgreSQL backup/restore procedures.

The traffic switch is best effort rather than a strict transactional boundary. In-flight
requests may complete on the MongoDB machine while new requests reach PostgreSQL, and those late
MongoDB Reports will not be reconciled into PostgreSQL. This bounded cutover loss is accepted.

The backup implementation is outside this application migration, but production cutover is blocked
until a separate PostgreSQL backup plan exists and a restore has been rehearsed successfully. The
expected direction is pgBackRest with private object storage and point-in-time recovery; that choice
must be finalized in the operational plan rather than implemented inside poi-server.
