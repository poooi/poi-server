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
databaseUrl = process.env.POI_SERVER_DATABASE_URL ?? process.env.POI_SERVER_DB
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
- `select_rank` upsert by admiral and map area.
- `remodel_recipe` upsert and count increment, while ignoring `stage === -1`.
- `remodel_recipe_deduplicate` duplicate cleanup by recipe key.
- `ship_stat` count increments by stat tuple.
- `enemy_info` count increments plus bomber range min/max merging.
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
| `new Model(info).save()` | `db.insert(table).values(info)` |
| `count()` / `countDocuments()` | Drizzle `count()` helper or `select count(*)` expression |
| `distinct('questId')` | `selectDistinct(table.questId)` and preserve current endpoint sort behavior |
| `findOne` then mutate/save for select rank | Unique key on `(teitoku_id, maparea_id)` with conflict update |
| `$setOnInsert` | Conflict update with immutable insert-only fields omitted from the update set |
| `$inc` | `count = table.count + 1` |
| `$min` | `first_client_observed_at = least(existing, excluded)` |
| `$max` | `last_reported = greatest(existing, excluded)` and same for client observed timestamp |
| `$addToSet` scalar or `$each` arrays | PostgreSQL array set-union expression with deterministic output where exported |
| Mongoose ObjectId export cursor | PostgreSQL `export_id char(24)` generated as ObjectId-compatible lowercase hex from a monotonic source such as a sequence-backed value |
| `.select('-__v -origins')` | Explicit selected column list that excludes `origins` |
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

4. **PostgreSQL actions**
   - Implement PostgreSQL v2 actions.
   - Implement PostgreSQL v3 quest and quest reward actions.
   - Implement PostgreSQL v3 item-improvement ingestion and export actions.

5. **Dual-backend tests**
   - Parameterize e2e setup by backend.
   - Add CI PostgreSQL service.
   - Run MongoDB and PostgreSQL behavior suites.
   - Assert `/api/status` returns both generic `database` counts and legacy `mongo` counts.

6. **Documentation and rollout**
   - Update `.env.example`, README, and deployment notes.
   - Deploy with MongoDB default unchanged.
   - Provision an empty PostgreSQL database.
   - Switch production by setting `POI_SERVER_DATABASE_URL` or `POI_SERVER_DB` to a PostgreSQL URI.

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
- Do not assume rollback preserves data written while PostgreSQL was active. With no migration,
  rollback restores service availability on MongoDB but reports accepted only by PostgreSQL will not
  appear in MongoDB.
- Do not implement PostgreSQL as a loose raw SQL side path. Keep Drizzle schema, migrations, and typed
  actions as the maintainability boundary.

## Rollout and rollback

Rollout:

1. Release the code with the MongoDB backend still selected.
2. Provision an empty PostgreSQL database.
3. Run migrations.
4. Switch configuration to PostgreSQL.
5. Monitor status counts, ingestion errors, and Sentry database spans.

Rollback:

1. Switch the configured database URI back to MongoDB.
2. Restart the service.

Because there is no data migration or dual-write requirement, rollback is a backend switch rather
than a data reconciliation process.
