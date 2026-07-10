# Run monthly dumps as an external maintenance job

Monthly dump, validation, publication, and cleanup will run outside the API server process as a scheduled maintenance job. This keeps ingestion focused on committing reports and lets dump retries, checksum validation, and publication failures be handled without coupling them to request serving.

Export is limited to months older than the rollover grace window. It checkpoints the inactive
database, writes a dump plus a checksum-bound manifest, and holds a per-month maintenance lock while
reading the source. A separate publication lock covers the full export; unique temporary outputs are
reclaimed after interrupted attempts and published with atomic no-replace links.

Cleanup is a separate invocation. It requires the original manifest and its externally verified
checksum, refuses months still owned by the API server, revalidates the same manifest bytes plus the
unchanged source and artifact while holding both locks, and never regenerates a dump before deletion.
