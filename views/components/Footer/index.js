import React from 'react'

import styles from './styles'
import githubIcon from './github.svg'
import weiboIcon from './weibo.svg'
import telegramIcon from './telegram.svg'
import discordIcon from './discord.svg'
import heartIcon from './heart.svg'

class Footer extends React.Component {
  getChildContext() {
    return {
      reactIconBase: { size: 30 }
    }
  }

  render() {
    const { __, locale } = this.context
    return (
      <div className={styles.footer}>
        <a href="http://weibo.com/letspoi" title={ __('weibo') }>
          <img src={weiboIcon} />
        </a>
        {
          ['zh-CN', 'zh-TW'].includes(locale) &&
          <a href={ __('telegram-group-link') } title={ __('telegram') }>
            <img src={telegramIcon} />
          </a>
        }
        {
          ['en-US', 'ja-JP', 'ja'].includes(locale) &&
          <a href={ __('discord-channel-link') } title={ __('Discord sub-channel') }>
            <img src={discordIcon} />
          </a>
        }
        <a href="https://github.com/poooi/poi" title={ __('github') }>
          <img src={githubIcon} />
        </a>
        <a href="https://opencollective.com/poi" title={ __('opencollective') }>
          <img src={heartIcon} />
        </a>
      </div>
    )
  }
}

Footer.childContextTypes = {
  reactIconBase: React.PropTypes.object
}

Footer.contextTypes = {
  __: React.PropTypes.func,
  locale: React.PropTypes.string,
}

export default Footer
