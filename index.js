/* eslint-disable @typescript-eslint/no-var-requires */

require('dotenv').config()

import('./src/app.ts').catch((err) => {
  console.error(err)
  process.exit(1)
})
