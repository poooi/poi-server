import { defineConfig } from 'drizzle-kit'

const databaseUrl =
  process.env.POI_SERVER_DATABASE_URL ??
  process.env.POI_SERVER_DB ??
  ['postgres://', 'postgres:postgres@', '127.0.0.1:5432/poi_test'].join('')

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/postgres/index.ts',
  out: './migrations/postgres',
  dbCredentials: {
    url: databaseUrl,
  },
})
