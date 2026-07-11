# Report data catalog

This document describes the report data currently persisted by poi-server. It is a readable snapshot,
not the source of truth for a permanent dataset count.

The authoritative implementation sources are:

- [`CONTEXT.md`](../CONTEXT.md) for the meanings of Observation, Current State, Aggregate, Definition,
  and Item-improvement Fact;
- [`src/dumps/community-dump-registry.ts`](../src/dumps/community-dump-registry.ts) for the datasets
  included in Community Dumps;
- [`src/db/postgres/schema.ts`](../src/db/postgres/schema.ts) for PostgreSQL storage;
- [`src/contracts/database.ts`](../src/contracts/database.ts) for the dataset names exposed by
  `/api/status`.

The current status catalog contains 18 report datasets:

| Classification        | Current count | Monthly partitioned | Removed after verified dump |
| --------------------- | ------------: | ------------------- | --------------------------- |
| Observation Dataset   |             9 | Yes                 | Yes                         |
| Current State         |             1 | No                  | No                          |
| Aggregate             |             3 | No                  | No                          |
| Definition            |             2 | No                  | No                          |
| Item-improvement Fact |             3 | No                  | No                          |

These counts describe the current model and are not permanent limits.

## Why there are currently nine monthly partitions

A PostgreSQL partition belongs to one parent table. For each Dump Month, poi-server creates one
monthly child partition for every Observation dataset registered for Community Dumps.

The registry currently contains nine Observation datasets, so one month currently has nine child
partitions:

```text
one Dump Month x nine registered Observation parent tables = nine monthly child partitions
```

This does **not** mean nine months are created. During July, for example, scheduled maintenance
ensures that each registered parent table has its August child partition. The number nine is only the
current dataset count; it can change when the report model, dump registry, and database schema are
changed together.

Only Observations use monthly partitions and the verified dump-retention cleanup path. Current State,
Aggregate, Definition, and Item-improvement Fact data remains in its regular tables.

## Partitioned Observation datasets

Every accepted Observation is retained independently. Each table is range-partitioned by
`ingested_at` using JST Dump Month boundaries and has a default partition as a safety net.

| Community Dump dataset      | PostgreSQL parent table | Report endpoint                       | What it records                                                          |
| --------------------------- | ----------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `createShipObservations`    | `create_ship_records`   | `POST /api/report/v2/create_ship`     | A ship-construction result and its construction context.                 |
| `createItemObservations`    | `create_item_records`   | `POST /api/report/v2/create_item`     | An equipment-development attempt, including success and result.          |
| `remodelItemObservations`   | `remodel_item_records`  | `POST /api/report/v2/remodel_item`    | An equipment-remodeling attempt and the participating ship context.      |
| `dropShipObservations`      | `drop_ship_records`     | `POST /api/report/v2/drop_ship`       | A ship or item drop outcome with map, battle, enemy, and player context. |
| `passEventObservations`     | `pass_event_records`    | `POST /api/report/v2/pass_event`      | An event-map completion and its rewards.                                 |
| `battleApiObservations`     | `battle_apis`           | `POST /api/report/v2/battle_api`      | A reported battle API path and raw payload.                              |
| `nightContactObservations`  | `night_contacts`        | `POST /api/report/v2/night_contcat`   | A night-contact result with fleet, ship, and equipment context.          |
| `aaciObservations`          | `aaci_records`          | `POST /api/report/v2/aaci`            | An anti-air cut-in availability and trigger result.                      |
| `nightBattleCiObservations` | `night_battle_cis`      | `POST /api/report/v2/night_battle_ci` | A night-battle cut-in result, including activation and damage details.   |

The `night_contcat` route spelling is a retained legacy API contract.

For a target month such as `2026-08`, the corresponding child tables use names such as
`create_ship_records_2026_08`, `create_item_records_2026_08`, and one equivalent child name for every
other registered Observation parent.

Each Community Dump publishes one compressed JSON Lines object per registered dataset. After
publication, object verification, and the cleanup grace period, cleanup detaches and drops only that
month's verified Observation child partitions.

Every dumped row starts with `observationId` and `ingestedAt`; the dataset-specific fields are defined
in the Community Dump registry.

## Non-partitioned report data

These datasets are exposed in `/api/status.database.estimatedCounts`, but they are not monthly
Observation partitions and are not removed by Community Dump cleanup.

### Current State

| Status dataset     | PostgreSQL table      | Report endpoint                   | What it retains                                                  |
| ------------------ | --------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `selectRankStates` | `select_rank_records` | `POST /api/report/v2/select_rank` | The latest selected map difficulty for each player and map area. |

### Aggregates

Repeated reports matching the same Domain Identity update one durable summary rather than creating
monthly Observation rows.

| Status dataset        | PostgreSQL table | Report endpoint                      | What it combines                                                      |
| --------------------- | ---------------- | ------------------------------------ | --------------------------------------------------------------------- |
| `recipeAggregates`    | `recipe_records` | `POST /api/report/v2/remodel_recipe` | Repeated reports of the same equipment-improvement recipe.            |
| `shipStatAggregates`  | `ship_stats`     | `POST /api/report/v2/ship_stat`      | Repeated reports of the same ship-level stat values.                  |
| `enemyInfoAggregates` | `enemy_infos`    | `POST /api/report/v2/enemy_info`     | Repeated sightings of the same enemy fleet composition and equipment. |

### Definitions

Definitions deduplicate descriptions of known game concepts.

| Status dataset           | PostgreSQL table | Report endpoint                    | What it defines                                                 |
| ------------------------ | ---------------- | ---------------------------------- | --------------------------------------------------------------- |
| `questDefinitions`       | `quests`         | `POST /api/report/v3/quest`        | Quest identity, title, detail, category, and type.              |
| `questRewardDefinitions` | `quest_rewards`  | `POST /api/report/v3/quest_reward` | A quest reward configuration, including selections and bonuses. |

### Item-improvement Facts

`POST /api/report/v3/item_improvement_recipe` normalizes submitted records into one or more Fact
types. Repeated support strengthens the matching Fact by updating timestamps, sources, origins,
observed flagship IDs, and report count.

| Status dataset                     | PostgreSQL table                      | Export endpoint                                            | What it claims                                                           |
| ---------------------------------- | ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `itemImprovementAvailabilityFacts` | `item_improvement_availability_facts` | `GET /api/report/v3/item_improvement_recipes/availability` | When an item-improvement recipe is available and which ships support it. |
| `itemImprovementCostFacts`         | `item_improvement_cost_facts`         | `GET /api/report/v3/item_improvement_recipes/costs`        | Resource and material costs for an item-improvement stage.               |
| `itemImprovementUpdateFacts`       | `item_improvement_update_facts`       | `GET /api/report/v3/item_improvement_recipes/updates`      | The upgraded item and resulting level produced by an improvement.        |

## Internal dump metadata

`data_dump_runs` and `data_dump_files` track publication status, manifests, object verification, and
the exact partition names used by cleanup. They are operational metadata, not report datasets and not
part of `/api/status.database.estimatedCounts`.

## Report endpoints without persisted report data

Some retained API routes intentionally do not add a dataset:

- `POST /api/report/v2/quest/:id` returns success without writing.
- `GET /api/report/v2/known_recipes` returns an empty recipe list.
- `POST /api/report/v2/night_battle_ss_ci` returns success without writing.
- `POST /api/report/v2/remodel_recipe_deduplicate` is maintenance for legacy MongoDB duplicates; it
  does not define another PostgreSQL report dataset.

## Updating this catalog

When report data changes:

1. Classify the data using the language in `CONTEXT.md`.
2. Add it to the Community Dump registry only if it is an independently retained Observation meant
   for monthly publication and retention cleanup.
3. Update the PostgreSQL schema, status count contract, migrations, tests, and this catalog together.
4. Describe partition counts as the current registry size, never as a permanent architectural
   constant.
