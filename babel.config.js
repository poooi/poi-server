module.exports = {
  presets: [["@babel/preset-env", {targets : { node: "14" }}]],
  plugins: [require.resolve('babel-plugin-add-module-exports')],
  cache: false,
}
