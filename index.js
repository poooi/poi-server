require('@babel/register')({
  cache: false,
  extensions: ['.ts'],
})

require('./app')
