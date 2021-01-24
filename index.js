/* eslint-disable @typescript-eslint/no-var-requires */

require('@babel/register')({
  cache: false,
  extensions: ['.ts'],
})

require('./src/app')
