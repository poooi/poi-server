import { defineConfig } from 'drizzle-kit'

import { resolveDatabaseUrl } from './src/db/backend'

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/postgres/schema.ts',
  dbCredentials: {
    url: resolveDatabaseUrl(process.env),
  },
  strict: true,
  verbose: true,
})
