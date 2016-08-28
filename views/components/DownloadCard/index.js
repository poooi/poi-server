import React from 'react'
import classNames from 'classnames'

import version from '../../meta/version'

import styles from './styles'

const BASE_URI = 'https://npm.taobao.org/mirrors/poi'

function getDownloadLink(version, target) {
  const pure = version.substring(1)
  switch (target) {
    case 'linux-x64':
      return `${BASE_URI}/${version}/poi-${pure}-linux-x64.7z`
    case 'linux-deb-x64':
      return `${BASE_URI}/${version}/poi-${pure}-linux-x64.deb`
    case 'linux-rpm-x64':
      return `${BASE_URI}/${version}/poi-${pure}-linux-x64.rpm`
    case 'macos-x64':
      return `${BASE_URI}/${version}/poi-${pure}-macos-x64.dmg`
    case 'win-ia32':
      return `${BASE_URI}/${version}/poi-${pure}-win-ia32.7z`
    case 'win-ia32-setup':
      return `${BASE_URI}/${version}/poi-${pure}-win-ia32-setup.exe`
    case 'win-x64':
      return `${BASE_URI}/${version}/poi-${pure}-win-x64.7z`
    case 'win-x64-setup':
      return `${BASE_URI}/${version}/poi-${pure}-win-x64-setup.exe`
    default:
      return 'https://github.com/poooi/poi/releases'
  }
}

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
