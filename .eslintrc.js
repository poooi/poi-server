module.exports = {
  env: {
    es6: true,
    node: true,
  },
  extends: ['eslint:recommended', 'plugin:import/errors', 'plugin:import/warnings', 'prettier'],
  parser: 'babel-eslint',
  plugins: ['import', 'prettier'],
  rules: {
    'no-console': 'off',
    'no-var': 'error',
    'no-unused-vars': ['warn', { args: 'none' }],
    'prettier/prettier': 'error',
  },
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.es', '.coffee', '.cjsx'],
        paths: [__dirname],
      },
    },
  },
}
