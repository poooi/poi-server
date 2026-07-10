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
  let path = db.startsWith('sqlite://') ? db.slice('sqlite://'.length) : db.slice('sqlite:'.length)
  if (process.platform === 'win32' && /^\/[a-z]:[\\/]/i.test(path)) {
    path = path.slice(1)
  }
  if (path === '') {
    throw new Error('SQLite database URL must include a path')
  }
  return path
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
