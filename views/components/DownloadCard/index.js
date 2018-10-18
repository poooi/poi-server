import React from 'react'
import classNames from 'classnames'

import version from '../../meta/version'

import styles from './styles'

const BASE_URI = 'https://npm.taobao.org/mirrors/poi'

function getDownloadLink(version, target) {
  const pure = version.substring(1)
  switch (target) {
  case 'linux-x64':
    return `${BASE_URI}/${version}/poi-${pure}.7z`
  case 'linux-deb-x64':
    return `${BASE_URI}/${version}/poi_${pure}_amd64.deb`
  case 'linux-rpm-x64':
    return `${BASE_URI}/${version}/poi-${pure}.x86_64.rpm`
  case 'macos-x64':
    return `${BASE_URI}/${version}/poi-${pure}.dmg`
  case 'win-ia32':
    return `${BASE_URI}/${version}/poi-${pure}-ia32-win.7z`
  case 'win-ia32-setup':
    return `${BASE_URI}/${version}/poi-setup-${pure}.exe`
  case 'win-x64':
    return `${BASE_URI}/${version}/poi-${pure}-win.7z`
  case 'win-x64-setup':
    return `${BASE_URI}/${version}/poi-setup-${pure}.exe`
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
  __: React.PropTypes.func,
}

export default DownloadCard
