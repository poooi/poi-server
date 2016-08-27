import React from 'react'
import classNames from 'classnames'

import version from '../../meta/version'

import styles from './styles'

const ext = {
  'linux-x64': '7z',
  'macos-x64': 'dmg',
  'win-ia32': '7z',
  'win-x64': '7z'
}

const getDownloadLink = (version, target) => (
  `https://npm.taobao.org/mirrors/poi/${version}/poi-${version.substring(1)}-${target}.${ext[target]}`
)

class DownloadCard extends React.Component {
  render() {
    const { __ } = this.context
    const { target } = this.props
    return (
      <div className={styles.container}>
        <div className={styles.header}>{ __('download-for') } { __(target) }</div>
        <a href={getDownloadLink(version.stable, target)}>
          <button className={classNames(styles.button, styles.stable)}>
            <div>{ version.stable }</div>
            <div className={styles.description}>{ __('stable-hint') }</div>
          </button>
        </a>
        { version.betaAvailable &&
          <a href={getDownloadLink(version.beta, target)}>
            <button className={classNames(styles.button, styles.beta)}>
              <div>{ version.beta }</div>
              <div className={styles.description}>{ __('beta-hint') }</div>
            </button>
          </a>
        }
      </div>
    )
  }
}

DownloadCard.contextTypes = {
  __: React.PropTypes.func
}

export default DownloadCard
