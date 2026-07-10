export type DatabaseBackend = 'mongo' | 'sqlite'

export const isMongoDatabaseUrl = (db: string) =>
  db.startsWith('mongodb:') || db.startsWith('mongodb+srv:')

export const isSqliteDatabaseUrl = (db: string) => db.startsWith('sqlite:')

export const resolveDatabaseBackend = (db: string): DatabaseBackend => {
  if (isMongoDatabaseUrl(db)) {
    return 'mongo'
  }
  if (isSqliteDatabaseUrl(db)) {
    return 'sqlite'
  }
  throw new Error(`Unsupported database URL scheme: ${db}`)
}
