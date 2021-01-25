import path from 'path'
const rootPath = path.normalize(__dirname)
import { defaults } from 'lodash'

interface EnvConfig {
  root: string
  port: number
  db: string
  disableLogger?: number
  env: string
}

const defaultConfig: EnvConfig = {
  root: rootPath,
  port: 17027,
  db: 'mongodb://localhost:27017/poi-development',
  env: 'development',
  disableLogger: 0,
}

const parseEnvInt = (value: string | undefined) => {
  const res = parseInt(value as string, 10)
  return Number.isFinite(res) ? res : undefined
}

export const config: Readonly<EnvConfig> = defaults<Partial<EnvConfig>, EnvConfig>(
  {
    port: parseEnvInt(process.env.POI_SERVER_PORT),
    db: process.env.POI_SERVER_DB,
    env: process.env.NODE_ENV,
    disableLogger: parseEnvInt(process.env.POI_SERVER_DISABLE_LOGGER),
  },
  defaultConfig,
)
