import React from 'react'
import ReactDOM from 'react-dom'
import Typist from 'react-typist'
import Slider from 'react-slick'
import UAParser from 'ua-parser-js'

import DownloadCard from '../DownloadCard'

import styles from './styles'
import poi from './poi.png'

const cursor = {
  hideWhenDone: true,
  element: '_'
}

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
    initialSlide = 4
    if (cpu.architecture === 'ia64' || cpu.architecture === 'amd64') {
      initialSlide = 6
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
  constructor() {
    super()
    this.state = { width: 0 }
  }

  componentDidMount() {
    const mirror = ReactDOM.findDOMNode(this.refs.mirror)
    this.setState({
      width: mirror.getBoundingClientRect().width
    })
  }

  render() {
    const { __ } = this.context
    return (
      <div className={styles.container}>
        <div className={styles.title}>
          <img src={poi} className={styles.logo} />
          <span className={styles.name}>{ __('name') }</span>
        </div>
        <div className={styles.description}>
          <div className={styles.wrapper} style={{ width: this.state.width }}>
            <Typist cursor={cursor}>
              { __('description') }
            </Typist>
          </div>
          <span ref="mirror" className={styles.mirror}>
            { __('description') }
          </span>
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
      </div>
    )
  }
}

MainPage.contextTypes = {
  __: React.PropTypes.func
}

export default MainPage
