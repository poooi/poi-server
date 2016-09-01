import React from 'react'
import FaWeibo from 'react-icons/fa/weibo'
import FaPaperPlane from 'react-icons/fa/paper-plane'
import FaGitHub from 'react-icons/fa/github'

import styles from './styles'

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
          <FaWeibo />
        </a>
        <a href="https://telegram.me/joinchat/AoMUpkCr6B8uH7EUewq6eQ"
           title={ __('telegram') }>
          <FaPaperPlane />
        </a>
        <a href="https://github.com/poooi/poi" title={ __('github') }>
          <FaGitHub />
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
