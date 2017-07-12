import React from 'react'
import ReactDOM from 'react-dom'
import GitHubRibbon from '../GitHubRibbon';
import '../../3rd/particleground'

import Header from '../Header'
import Footer from '../Footer'

import en_US from '../../intl/en-US'
import zh_CN from '../../intl/zh-CN'
import zh_TW from '../../intl/zh-TW'
import ja_JP from '../../intl/ja-JP'

import styles from './styles'

const intl = language => key => {
  switch (language) {
  case 'zh-CN':
    return zh_CN[key]
  case 'zh-TW':
    return zh_TW[key]
  case 'ja':
  case 'ja-JP':
    return ja_JP[key]
  default:
    return en_US[key]
  }
}

class App extends React.Component {
  switchLanguage(lang) {
    const { pathname, query } = this.props.location
    query.locale = lang
    this.context.router.replace({ pathname, query })
  }

  getChildContext() {
    const locale = this.props.location.query.locale || navigator.language
    return {
      __: intl(locale),
      switchLanguage: (lang) => this.switchLanguage(lang),
      locale
    }
  }

  componentDidMount() {
    window.particleground(ReactDOM.findDOMNode(this.refs.ground), {
      dotColor: 'rgba(255, 255, 255, 0.6)',
      lineColor: 'rgba(255, 255, 255, 0.1)',
      density: 14400,
      curvedLines: false,
      proximity: 100,
      parallaxMultiplier: 20,
      particleRadius: 2
    })
  }

  render() {
    return (
      <div className={styles.container}>
        <GitHubRibbon />
        <div ref="ground" className={styles.ground} />
        <div className={styles.wrapper}>
          <Header />
          { this.props.children }
          <Footer />
        </div>
      </div>
    )
  }
}

App.childContextTypes = {
  __: React.PropTypes.func,
  switchLanguage: React.PropTypes.func,
  locale: React.PropTypes.string
}

App.contextTypes = {
  router: React.PropTypes.object
}

export default App
