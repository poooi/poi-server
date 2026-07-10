import fs from 'fs'
import path from 'path'
import lockfile from 'proper-lockfile'

export interface SqliteFileLock {
  release: () => void
}

const ownedLocks = new Set<string>()

const acquireSqliteFileLock = (
  directory: string,
  name: string,
  inUseMessage: string,
): SqliteFileLock => {
  fs.mkdirSync(directory, { recursive: true })
  const lockTarget = path.resolve(directory, name)
  if (ownedLocks.has(lockTarget)) {
    throw new Error(inUseMessage)
  }

  try {
    const release = lockfile.lockSync(lockTarget, {
      realpath: false,
      retries: 0,
      stale: 120_000,
      update: 30_000,
    })
    ownedLocks.add(lockTarget)
    let released = false
    return {
      release: () => {
        if (released) {
          return
        }
        released = true
        ownedLocks.delete(lockTarget)
        release()
      },
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new Error(inUseMessage)
    }
    throw err
  }
}

export const acquireAppendOnlyMonthLock = (appendOnlyDir: string, month: string): SqliteFileLock =>
  acquireSqliteFileLock(
    appendOnlyDir,
    `append-only-${month}`,
    `Append-only SQLite month ${month} is currently in use`,
  )

export const acquireDumpPublicationLock = (outputDir: string, month: string): SqliteFileLock =>
  acquireSqliteFileLock(
    outputDir,
    `append-only-${month}.publication`,
    `Append-only dump outputs for ${month} are currently in use`,
  )

export const acquireOperationalMigrationLock = async (sqlitePath: string) => {
  const directory = path.dirname(sqlitePath)
  fs.mkdirSync(directory, { recursive: true })
  const lockTarget = path.resolve(directory, `${path.basename(sqlitePath)}.migration`)
  const release = await lockfile.lock(lockTarget, {
    realpath: false,
    retries: {
      factor: 1.5,
      maxTimeout: 500,
      minTimeout: 100,
      retries: 10,
    },
    stale: 120_000,
    update: 30_000,
  })
  return { release }
}
