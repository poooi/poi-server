gulp = require 'gulp'
nodemon = require 'gulp-nodemon'
livereload = require 'gulp-livereload'

gulp.task 'develop', ->
  livereload.listen()
  nodemon
    script: 'index.js'
    ext: 'js coffee jade'
    nodeArgs: ['--harmony']
  .on 'restart', ->
    setTimeout ->
      livereload.changed __dirname
    , 1000

gulp.task 'default', [
  'develop',
]
