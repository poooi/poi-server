# Separate operational backups from community dumps

Operational SQLite data will have its own backup policy and will not be removed by monthly community dump cleanup. Community dumps exist to publish and reclaim append-only report data; operational backups exist to recover live state.
