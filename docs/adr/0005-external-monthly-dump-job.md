# Run monthly dumps as an external maintenance job

Monthly dump, validation, publication, and cleanup will run outside the API server process as a scheduled maintenance job. This keeps ingestion focused on committing reports and lets dump retries, checksum validation, and publication failures be handled without coupling them to request serving.
