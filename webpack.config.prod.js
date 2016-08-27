const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  entry: [
    'babel-polyfill',
    './views/index.js'
  ],
  output: {
    path: `${__dirname}/public`,
    publicPath: '/',
    filename: 'app.[hash].js'
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': '"production"'
    }),
    new webpack.NoErrorsPlugin(),
    new HtmlWebpackPlugin({
      template: 'templates/index.ejs'
    })
  ],
  module: {
    loaders: [
      {
        test: /\.js$/,
        exclude: /node_modules\/(?!react-icons)/,
        loader: 'babel',
        query: {
          presets: ['latest', 'react']
        }
      }, {
        test: /\.css$/,
        loaders: ['style', 'css?modules&importLoaders=1', 'postcss']
      }, {
        test: /\.(png|jpg|jpeg|gif|svg|woff|woff2)(\?v=\d+\.\d+\.\d+)?$/,
        loaders: ['url?limit=10000']
      }, {
        test: /\.(eot|ttf|wav|mp3)(\?v=\d+\.\d+\.\d+)?$/,
        loaders: ['file']
      }
    ]
  },
  resolve: {
    extensions: ['', '.js', '.css']
  },
  postcss: [
    require('postcss-cssnext')
  ]
}
