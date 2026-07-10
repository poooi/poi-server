# Use one monthly SQLite file for append-only report data

Append-only report data will be stored in one SQLite file per month containing all append-only report tables, rather than one file per collection. This keeps routing, dump validation, publication, and cleanup aligned around the monthly dump lifecycle; per-collection files can be reconsidered only if the dominant `dropshiprecords` table needs independent retry or storage handling.
