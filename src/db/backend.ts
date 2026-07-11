export type DatabaseBackend = 'mongodb' | 'postgresql'

const defaultDatabaseUrl = 'mongodb://localhost:27017/poi-development'

export const resolveDatabaseUrl = (
  env: Partial<Pick<NodeJS.ProcessEnv, 'POI_SERVER_DATABASE_URL' | 'POI_SERVER_DB'>>,
) => env.POI_SERVER_DATABASE_URL || env.POI_SERVER_DB || defaultDatabaseUrl

export const redactDatabaseUrl = (databaseUrl: string): string => {
  try {
    const url = new URL(databaseUrl)
    if (url.username !== '' || url.password !== '') {
      return `${url.protocol}//<redacted>@${url.host}${url.pathname}${url.search}${url.hash}`
    }
    return url.toString()
  } catch {
    return '<invalid database URL>'
  }
}

export const resolveDatabaseBackend = (databaseUrl: string): DatabaseBackend => {
  let protocol: string
  try {
    protocol = new URL(databaseUrl).protocol
  } catch {
    throw new Error(`Invalid database URL: ${redactDatabaseUrl(databaseUrl)}`)
  }

  switch (protocol) {
    case 'mongodb:':
    case 'mongodb+srv:':
      return 'mongodb'
    case 'postgres:':
    case 'postgresql:':
      return 'postgresql'
    default:
      throw new Error(
        `Unsupported database URL scheme in ${redactDatabaseUrl(databaseUrl)}`,
      )
  }
}
