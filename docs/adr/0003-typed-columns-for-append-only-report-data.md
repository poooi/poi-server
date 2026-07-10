# Use typed columns for append-only report data

Append-only report data will be stored in typed SQLite columns matching the current append-only Mongoose schemas, plus storage metadata such as a primary key and server receipt timestamp. Raw JSON-only storage was rejected because typed columns make validation, dump generation, and compatibility with the public dump record shape easier to reason about.
