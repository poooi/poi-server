import React from 'react'
import ReactDOM from 'react-dom'
import { Router, Route, hashHistory, IndexRoute } from 'react-router'

import App from './components/App'
import MainPage from './components/MainPage'

import './styles'

const routes = (
  <Router history={hashHistory}>
    <Route path="/" component={App}>
      <IndexRoute component={MainPage} />
    </Route>
  </Router>
)

ReactDOM.render(routes, document.getElementById('root'))
