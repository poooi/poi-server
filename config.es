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
    db: 'mongodb://localhost/poi-development',
    secret: 'DevelopmentSecret',
  },
  test: {
    root: rootPath,
    app: {
      name: 'poi',
    },
    port: 17027,
    db: 'mongodb://localhost/poi-test',
    secret: 'TestSecret',
  },
  production: {
    root: rootPath,
    app: {
      name: 'poi',
    },
    port: 17027,
    db: 'mongodb://localhost/poi-production',
    secret: 'ProductionSecret',
    disableLogger: true,
  },
}

export default config[env]
