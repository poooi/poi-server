# Store internal and public identities for append-only records

Append-only SQLite records will have an internal integer primary key for cutoff, export, and deletion mechanics, plus a stable generated 24-hex public ID with a uniqueness constraint used as the `_id` value in published dumps. This keeps operational mechanics simple while preserving an ObjectId-like identity for community dump consumers.
