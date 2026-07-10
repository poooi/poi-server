export class SqliteWriteQueueFullError extends Error {
  constructor() {
    super('SQLite write queue is full')
  }
}

interface QueueState {
  pendingWrites: number
  tail: Promise<void>
}

const queues = new Map<string, QueueState>()

const getMaxQueueSize = () => {
  const value = parseInt(process.env.POI_SERVER_SQLITE_WRITE_QUEUE_SIZE || '1000', 10)
  return Number.isFinite(value) && value >= 0 ? value : 1000
}

const getQueue = (key: string) => {
  let queue = queues.get(key)
  if (queue == null) {
    queue = {
      pendingWrites: 0,
      tail: Promise.resolve(),
    }
    queues.set(key, queue)
  }
  return queue
}

export const runSqliteWrite = async <T>(
  queueKey: string,
  write: () => T | Promise<T>,
): Promise<T> => {
  const queue = getQueue(queueKey)
  if (queue.pendingWrites >= getMaxQueueSize()) {
    throw new SqliteWriteQueueFullError()
  }

  queue.pendingWrites += 1
  const previous = queue.tail
  let release: () => void
  queue.tail = new Promise<void>((resolve) => {
    release = resolve
  })

  try {
    await previous
    return await write()
  } finally {
    queue.pendingWrites -= 1
    release!()
  }
}
