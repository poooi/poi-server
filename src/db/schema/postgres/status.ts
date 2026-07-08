import { bigint, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

// See "Community data dumps and retention" in docs/postgresql-migration-plan.md.
export const dataDumpRuns = pgTable('data_dump_runs', {
  id: serial('id').primaryKey(),
  tableName: text('table_name').notNull(),
  dumpMonth: text('dump_month').notNull(),
  rowCount: bigint('row_count', { mode: 'number' }).notNull(),
  checksum: text('checksum').notNull(),
  outputLocation: text('output_location').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }).notNull(),
  cleanedUpAt: timestamp('cleaned_up_at', { withTimezone: true, mode: 'date' }),
})
