export class SqliteWriteQueueFullError extends Error {
  constructor() {
    super('SQLite write queue is full')
  }
}

let pendingWrites = 0
let tail: Promise<void> = Promise.resolve()

const getMaxQueueSize = () => {
  const value = parseInt(process.env.POI_SERVER_SQLITE_WRITE_QUEUE_SIZE || '1000', 10)
  return Number.isFinite(value) ? value : 1000
}

export const runSqliteWrite = async <T>(write: () => T): Promise<T> => {
  if (pendingWrites >= getMaxQueueSize()) {
    throw new SqliteWriteQueueFullError()
  }

  pendingWrites += 1
  const previous = tail
  let release: () => void
  tail = new Promise<void>((resolve) => {
    release = resolve
  })

  try {
    await previous
    return write()
  } finally {
    pendingWrites -= 1
    release!()
  }
}

export const resetSqliteWriteQueue = () => {
  pendingWrites = 0
  tail = Promise.resolve()
}
