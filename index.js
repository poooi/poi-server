/* eslint-disable @typescript-eslint/no-var-requires */

const { register } = require('esbuild-register/dist/node')

require('dotenv').config()
register()

require('./src/app')
