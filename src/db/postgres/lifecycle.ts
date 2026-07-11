export const EXPECTED_POSTGRES_SCHEMA_VERSION = 2

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
