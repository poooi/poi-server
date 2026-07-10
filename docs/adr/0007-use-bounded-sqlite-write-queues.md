# Use bounded write queues for SQLite writes

SQLite writes will go through bounded per-database-file queues instead of relying only on driver serialization. This makes SQLite's single-writer behavior visible, supports queue-depth and latency metrics, and provides a controlled backpressure point during bursts.
