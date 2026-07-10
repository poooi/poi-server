# Poi Server

Poi Server collects report data from clients and serves derived/reporting APIs for the community.

## Language

**Append-only report data**:
Write-only report records that are kept only until they are included in a monthly community dump. In the current system this means `dropshiprecords`, `createitemrecords`, `createshiprecords`, `nightcontactrecords`, and `aacirecords`.
_Avoid_: CRUD data, stateful data

**Operational data**:
Stateful data that remains in the live database because the application queries, upserts, deduplicates, or exports it through APIs. Operational data is not removed by monthly dump cleanup.
_Avoid_: CRUD data

**Monthly dump**:
The recurring process that exports append-only report data, validates and publishes the export, then removes only the exported records from live storage.
_Avoid_: backup, archive

**Validated dump**:
A monthly dump whose per-table row counts, per-table content checksums, compressed file checksum, and upload/publish verification have all succeeded.
_Avoid_: uploaded dump, generated dump

**Acknowledged report**:
A report request for which the server has returned success after the report record has been committed to storage. Overloaded writes should fail with a retryable error rather than creating acknowledged-but-uncommitted reports.
_Avoid_: accepted report

**Public dump record shape**:
The collection-oriented record format expected by consumers of the existing community data dumps. SQLite migration should preserve this shape as much as practical for append-only report data.
_Avoid_: internal schema, storage schema

**Report receipt month**:
The UTC calendar month, determined from server receipt time, that owns an append-only report record for storage, dump, and cleanup purposes.
_Avoid_: client month, payload month

**Rollover grace window**:
The period after a month boundary before the previous report receipt month is considered ready for monthly dump. For append-only report data, this window lasts until the next day.
_Avoid_: dump delay, rollover delay
