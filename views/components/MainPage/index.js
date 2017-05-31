import React from 'react'
import Slider from 'react-slick'
import UAParser from 'ua-parser-js'
import classnames from 'classnames'

import DownloadCard from '../DownloadCard'
import TypeCat from '../TypeCat'

import styles from './styles'
import poi from './poi.png'

function getSettings() {
  const { os, cpu } = new UAParser().getResult()
  let initialSlide = 0
  if (os.name === 'Linux') {
    initialSlide = 0
  } else if (os.name === 'Debian' || os.name === 'Ubuntu') {
    initialSlide = 1
  } else if (os.name === 'CentOS' || os.name === 'Fedora') {
    initialSlide = 2
  } else if (os.name === 'Mac OS') {
    initialSlide = 3
  } else if (os.name === 'Windows') {
    initialSlide = 5
    if (cpu.architecture === 'ia64' || cpu.architecture === 'amd64') {
      initialSlide = 7
    }
  }
  return {
    infinite: true,
    speed: 500,
    slidesToShow: 1,
    slidesToScroll: 1,
    initialSlide
  }
}

class MainPage extends React.Component {
  render() {
    const { __ } = this.context
    return (
      <div className={styles.container}>
        <div className={styles.title}>
          <img src={poi} className={classnames(styles.logo, {
            [styles.aprilfoolsday]: (new Date().getMonth() === 3 && new Date().getDate() === 1),
          })} />
          <span className={styles.name}>{ __('name') }</span>
        </div>
        <div className={styles.description}>
          <TypeCat text={__('description')} />
        </div>
        <div className={styles.slider}>
          <Slider {...getSettings()}>
            <div><DownloadCard target="linux-x64" /></div>
            <div><DownloadCard target="linux-deb-x64" /></div>
            <div><DownloadCard target="linux-rpm-x64" /></div>
            <div><DownloadCard target="macos-x64" /></div>
            <div><DownloadCard target="win-ia32" /></div>
            <div><DownloadCard target="win-ia32-setup" /></div>
            <div><DownloadCard target="win-x64" /></div>
            <div><DownloadCard target="win-x64-setup" /></div>
          </Slider>
        </div>
        <div className={styles.others}>
          <a href="https://npm.taobao.org/mirrors/poi" target="_blank">
            { __('other-versions') }
          </a>
        </div>
      </div>
    )
  }
}

MainPage.contextTypes = {
  __: React.PropTypes.func
}

export default MainPage
