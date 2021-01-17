import path from 'path'
const rootPath = path.normalize(__dirname)
const env      = process.env.NODE_ENV || 'development'

const config = {
  development: {
    root: rootPath,
    app: {
      name: 'poi',
    },
    port: 17027,
    db: 'mongodb://localhost:27017/poi-development',
    secret: 'DevelopmentSecret',
    env,
  },
  test: {
    root: rootPath,
    app: {
      name: 'poi',
    },
    port: 17027,
    db: 'mongodb://localhost:27017/poi-test',
    secret: 'TestSecret',
    env,
  },
  production: {
    root: rootPath,
    app: {
      name: 'poi',
    },
    port: 17027,
    db: 'mongodb://localhost:27017/poi-production',
    secret: 'ProductionSecret',
    disableLogger: true,
    env,
  },
}

export default config[env]
