import { type DataEpoch } from '../../contracts/database'

export const EXPECTED_POSTGRES_SCHEMA_VERSION = 1

export interface PostgresQueryClient {
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>
}

const readSchemaVersion = async (client: PostgresQueryClient): Promise<number> => {
  let result: { rows: Array<Record<string, unknown>> }
  try {
    result = await client.query('select version from schema_metadata where singleton = true')
  } catch (error) {
    const message = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(`PostgreSQL schema metadata is missing; run npm run db:migrate${message}`)
  }
  if (result.rows.length !== 1) {
    throw new Error('PostgreSQL schema metadata is missing; run npm run db:migrate')
  }
  const version = result.rows[0].version
  if (typeof version !== 'number') {
    throw new Error('PostgreSQL schema metadata contains an invalid version')
  }
  return version
}

export const verifyPostgresSchema = async (client: PostgresQueryClient): Promise<void> => {
  const version = await readSchemaVersion(client)
  if (version !== EXPECTED_POSTGRES_SCHEMA_VERSION) {
    throw new Error(
      `PostgreSQL expected schema version ${EXPECTED_POSTGRES_SCHEMA_VERSION} but found ${version}; run npm run db:migrate`,
    )
  }
}

const toDataEpoch = (row: Record<string, unknown>): DataEpoch => {
  if (typeof row.id !== 'string' || !(row.started_at instanceof Date)) {
    throw new Error('PostgreSQL Data Epoch contains invalid values')
  }
  return {
    id: row.id,
    startedAt: row.started_at.toISOString(),
  }
}

export const createDataEpoch = async (
  client: PostgresQueryClient,
  epoch: { id: string; startedAt: Date },
): Promise<DataEpoch> => {
  await verifyPostgresSchema(client)
  if (Number.isNaN(epoch.startedAt.getTime())) {
    throw new Error('Data Epoch start must be a valid timestamp')
  }
  const result = await client.query(
    `insert into data_epochs (singleton, id, started_at)
     select true, $1, $2
     where not exists (select 1 from data_epochs)
     returning id, started_at`,
    [epoch.id, epoch.startedAt],
  )
  if (result.rows.length !== 1) {
    throw new Error(
      'PostgreSQL database already has a Data Epoch; starting another requires a new database',
    )
  }
  return toDataEpoch(result.rows[0])
}

export const verifyPostgresDatabase = async (client: PostgresQueryClient): Promise<DataEpoch> => {
  await verifyPostgresSchema(client)

  const epochResult = await client.query(
    'select id, started_at from data_epochs order by created_at limit 2',
  )
  if (epochResult.rows.length !== 1) {
    throw new Error(
      `PostgreSQL startup requires exactly one Data Epoch; found ${epochResult.rows.length}`,
    )
  }
  return toDataEpoch(epochResult.rows[0])
}
