import React from 'react'

import styles from './styles'
import githubIcon from './github.svg'
import weiboIcon from './weibo.svg'
import telegramIcon from './telegram.svg'

class Footer extends React.Component {
  getChildContext() {
    return {
      reactIconBase: { size: 30 }
    }
  }

  render() {
    const { __ } = this.context
    return (
      <div className={styles.footer}>
        <a href="http://weibo.com/letspoi" title={ __('weibo') }>
          <img src={weiboIcon} />
        </a>
        <a href="https://telegram.me/joinchat/AoMUpkCr6B8uH7EUewq6eQ"
           title={ __('telegram') }>
          <img src={telegramIcon} />
        </a>
        <a href="https://github.com/poooi/poi" title={ __('github') }>
          <img src={githubIcon} />
        </a>
      </div>
    )
  }
}

Footer.childContextTypes = {
  reactIconBase: React.PropTypes.object
}

Footer.contextTypes = {
  __: React.PropTypes.func
}

export default Footer
