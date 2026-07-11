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

Create the upcoming monthly partition for every registered Observation dataset before the month
boundary:

```powershell
npm run db:partitions:create-upcoming -- 2026-08
```

If a default partition already contains rows for a month, repair one allowlisted Observation table
at a time:

```powershell
npm run db:partitions:repair -- create_ship_records 2026-08
```

Both commands are idempotent and reject catalog or boundary mismatches.

Each registered dataset has a separate PostgreSQL parent table, so one target month needs one child
partition per dataset. There are currently nine registered Observation datasets, which means the
command currently creates nine child partitions **for the same month**. This is not nine months of
partitions, and the count should be expected to follow the Community Dump registry if datasets are
added or removed. See the [report data catalog](report-data.md) for the current datasets and their
classifications.

## Community Dumps

### Cloudflare R2 credentials

Community Dump publication uses Cloudflare R2's S3-compatible API. It requires R2 S3 credentials, not
a general Cloudflare API token:

1. Create or select the target R2 bucket.
2. In the R2 API Tokens page, create a user or account API token with **Object Read & Write**
   permission, scoped to that bucket only.
3. Save the generated Access Key ID and Secret Access Key when Cloudflare displays them. The secret
   is shown only once.
4. Put the credentials and bucket configuration in the deployment machine's ignored `.env` file:

```dotenv
POI_SERVER_DUMP_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
POI_SERVER_DUMP_R2_BUCKET=<bucket-name>
POI_SERVER_DUMP_R2_ACCESS_KEY_ID=<access-key-id>
POI_SERVER_DUMP_R2_SECRET_ACCESS_KEY=<secret-access-key>
POI_SERVER_DUMP_R2_REGION=auto
POI_SERVER_DUMP_R2_FORCE_PATH_STYLE=true
```

Use the endpoint shown for the bucket in Cloudflare if it differs from the standard account endpoint.
See Cloudflare's [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/) and
[S3 API](https://developers.cloudflare.com/r2/get-started/s3/) documentation.

Both read and write access are required: publication uploads each immutable object and immediately
reads it back to verify its byte count and SHA-256; cleanup later reads every object again before
dropping database partitions.

The cron installer does not create, copy, or print credentials. The maintenance TypeScript entrypoint
loads the ignored `.env` file at runtime under the configured service user. Keep the file readable
only by the deployment and service accounts, and never commit these values or store them in CI.

The four endpoint, bucket, access-key, and secret-key variables are required.
`POI_SERVER_DUMP_R2_REGION` and `POI_SERVER_DUMP_R2_FORCE_PATH_STYLE` are optional and default to
`auto` and `true`.

Publish a closed JST Dump Month:

```powershell
npm run db:dumps:publish -- 2026-07
```

The command streams and verifies the target month's partition for every registered Observation
dataset, uploads immutable data objects, then uploads the verified manifest as the publication commit
point. It is safe to retry and never overwrites an existing object.

After the seven-day grace period, clean one exact run ID:

```powershell
npm run db:dumps:cleanup -- 42
```

Cleanup re-verifies the manifest, every data object, metadata, and partition bounds before
transactionally detaching and dropping the complete registered set of Observation partitions for
that Dump Month. Current State, Aggregate, Definition, and Item-improvement Fact tables are retained.

### Scheduled maintenance

Automated maintenance has three layers:

| Entry point                       | Purpose                                                              |
| --------------------------------- | -------------------------------------------------------------------- |
| `npm run db:dumps:maintain`       | Runs the TypeScript maintenance command directly.                    |
| `run-monthly-dump-maintenance.sh` | Adds locking, timeout enforcement, and timestamped operational logs. |
| `setup-monthly-dump-cron.sh`      | Installs or updates the managed crontab entry.                       |

#### Maintenance command

Run the underlying command manually from the application checkout:

```bash
npm run db:dumps:maintain
```

The command derives calendar months from the current JST date and:

1. Creates one partition for each registered Observation dataset for the next JST Dump Month.
2. Idempotently publishes the previous, fully closed Dump Month.
3. Finds cleanup candidates using the PostgreSQL clock and cleans every run whose seven-day grace
   period has elapsed.

The three phases are attempted independently. A partition-creation failure does not prevent
publication or eligible cleanup, and one failed cleanup does not prevent later candidates from being
attempted. Any failure produces a nonzero exit after all possible work has completed. A successful
run prints a JSON summary.

The command loads the database and R2 settings from the process environment and the ignored `.env`
file. It refuses non-PostgreSQL database URLs.

#### Maintenance runner

Run the operational wrapper as the service user:

```bash
./run-monthly-dump-maintenance.sh
```

The runner:

- takes a non-blocking `flock`; an overlapping invocation logs `status=skipped reason=overlap` and
  exits successfully;
- terminates maintenance after the configured timeout so a hung process cannot block future runs;
- logs start, success, failure, exit code, and elapsed time without shell tracing or environment
  values;
- delegates Node.js selection to `fnm-exec`.

`POI_DUMP_CRON_APP_DIR`, `POI_DUMP_CRON_LOCK_FILE`, and `POI_DUMP_CRON_TIMEOUT` may be set when
running the wrapper manually; direct invocations use GNU `timeout` duration syntax. The installer
accepts positive integers followed by `s`, `m`, `h`, or `d`, such as `90m` or `12h`.

#### Cron installer

The installer requires Linux, Bash, `crontab`, GNU `date`, GNU `timeout`, util-linux `flock`, and a
cron implementation supporting `CRON_TZ`. Run it as root from the application checkout:

```bash
sudo env \
  POI_DUMP_CRON_APP_DIR=<application-directory> \
  POI_DUMP_CRON_USER=<service-user> \
  ./setup-monthly-dump-cron.sh
```

The application checkout, `run-monthly-dump-maintenance.sh`, `fnm-exec`, and ignored `.env` file must
be readable by the selected service user. The installer:

1. Validates the user, five-field schedule, paths, timeout, and required executables.
2. Creates the log and lock files with service-user ownership.
3. Reads the selected user's existing crontab.
4. Preserves all unrelated entries and replaces only the block between
   `# BEGIN poi-server monthly dump` and `# END poi-server monthly dump`.
5. Rejects malformed or duplicated managed markers instead of discarding surrounding entries.

Re-running the installer is the supported way to change the schedule or paths. By default the job
runs daily at 00:30 JST. Daily execution provides automatic retries while the publish and cleanup
workflows remain idempotent.

| Variable                  | Meaning                                                            | Default                     |
| ------------------------- | ------------------------------------------------------------------ | --------------------------- |
| `POI_DUMP_CRON_APP_DIR`   | Application checkout containing both shell scripts and `fnm-exec`. | Built-in deployment default |
| `POI_DUMP_CRON_USER`      | User whose crontab runs maintenance.                               | `poi`                       |
| `POI_DUMP_CRON_SCHEDULE`  | Five-field cron expression interpreted in `Asia/Tokyo`.            | `30 0 * * *`                |
| `POI_DUMP_CRON_LOG_FILE`  | Combined runner and maintenance output.                            | Built-in log location       |
| `POI_DUMP_CRON_LOCK_FILE` | File used by `flock` to prevent overlap.                           | Built-in lock location      |
| `POI_DUMP_CRON_TIMEOUT`   | Maximum duration accepted by GNU `timeout`.                        | `12h`                       |

Verify the installed entry and inspect its output:

```bash
sudo crontab -u <service-user> -l
sudo tail -n 100 <log-file>
```

To disable automation, remove the complete managed marker block from the selected user's crontab.
Removing the block does not delete published objects, database metadata, logs, or lock files.

## Operational checks

- Deploy logs include timestamped stages, previous and target commit IDs, total elapsed time, and the
  failed stage and exit code. Shell tracing and environment-value logging remain disabled.
- `/api/status.database` reports the active backend and approximate counts.
- Monitor validation/database errors, pool active/idle/waiting clients, lock waits, statement
  latency, CPU, and storage latency.
- Do not store production Cloudflare credentials in CI.
- Production cutover remains blocked until PostgreSQL backup/restore has been rehearsed.
