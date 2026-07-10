export type DatabaseBackend = 'mongo' | 'sqlite'

export const isMongoDatabaseUrl = (db: string) =>
  db.startsWith('mongodb:') || db.startsWith('mongodb+srv:')

export const isSqliteDatabaseUrl = (db: string) => db.startsWith('sqlite:')

export const getDatabaseUrlScheme = (db: string) => {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(db)
  return match == null ? '<none>' : `${match[1]}:`
}

export const stripSqliteDatabaseUrl = (db: string) => {
  if (!isSqliteDatabaseUrl(db)) {
    return db
  }
  if (db.startsWith('sqlite://')) {
    return db.slice('sqlite://'.length)
  }
  return db.slice('sqlite:'.length)
}

export const resolveDatabaseBackend = (db: string): DatabaseBackend => {
  if (isMongoDatabaseUrl(db)) {
    return 'mongo'
  }
  if (isSqliteDatabaseUrl(db)) {
    return 'sqlite'
  }
  throw new Error(`Unsupported database URL scheme: ${getDatabaseUrlScheme(db)}`)
}
