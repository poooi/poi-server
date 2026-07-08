const defaultDatabaseUrl = 'mongodb://localhost:27017/poi-development'

export type DatabaseBackend = 'mongo' | 'postgres'
export interface DatabaseEnv {
  POI_SERVER_DATABASE_URL?: string
  POI_SERVER_DB?: string
}

const databaseSchemePattern = /^([a-z0-9+.-]+):/i

export const redactDatabaseCredentials = (message: string) =>
  message.replace(/(([a-z0-9+.-]+):\/\/)([^:@/?#]+):([^@/?#]+)@/gi, '$1<redacted>@')

export const resolveDatabaseUrl = (env: DatabaseEnv = process.env) =>
  env.POI_SERVER_DATABASE_URL || env.POI_SERVER_DB || defaultDatabaseUrl

export const resolveDatabaseBackend = (databaseUrl: string): DatabaseBackend => {
  const scheme = databaseUrl.match(databaseSchemePattern)?.[1]?.toLowerCase()

  switch (scheme) {
    case 'mongodb':
    case 'mongodb+srv':
      return 'mongo'
    case 'postgres':
    case 'postgresql':
      return 'postgres'
    default:
      throw new Error(
        `Unsupported database URL scheme in ${redactDatabaseCredentials(databaseUrl)}`,
      )
  }
}
