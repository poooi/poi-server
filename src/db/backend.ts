export type DatabaseBackend = 'mongodb' | 'postgres'

export const redactConnectionCredentials = (url: string): string =>
  url.replace(/(\/\/)([^/?#]+)@/g, '$1<redacted>@')

export const resolveBackend = (databaseUrl: string): DatabaseBackend => {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(databaseUrl)
  } catch {
    throw new Error(`Invalid database URL: ${redactConnectionCredentials(databaseUrl)}`)
  }

  switch (parsedUrl.protocol) {
    case 'mongodb:':
    case 'mongodb+srv:':
      return 'mongodb'
    case 'postgres:':
    case 'postgresql:':
      return 'postgres'
    default:
      throw new Error(
        `Unsupported database URL scheme "${parsedUrl.protocol}": ${redactConnectionCredentials(databaseUrl)}`,
      )
  }
}
