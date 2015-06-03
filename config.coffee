path     = require 'path'
rootPath = path.normalize __dirname
env      = process.env.NODE_ENV || 'development'

config =
  development:
    root: rootPath
    app:
      name: 'poi'
    port: 17027
    db: 'mongodb://localhost/poi-development'
    secret: 'DevelopmentSecret'

  test:
    root: rootPath
    app:
      name: 'poi'
    port: 17027
    db: 'mongodb://localhost/poi-test'
    secret: 'TestSecret'

  production:
    root: rootPath
    app:
      name: 'poi'
    port: 17027
    db: 'mongodb://localhost/poi-production'
    secret: 'ProductionSecret'

module.exports = config[env]
