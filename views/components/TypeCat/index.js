import React from 'react'
import ReactDOM from 'react-dom'
import classNames from 'classnames'
import Typist from 'react-typist'

import styles from './styles'

const cursor = {
  hideWhenDone: true,
  element: '_'
}

class TypeCat extends React.Component {
  constructor() {
    super()
    this.state = {
      stage: 'loaded',
      width: 0
    }
  }

  componentDidMount() {
    const mirror = ReactDOM.findDOMNode(this.refs.mirror)
    this.setState({
      stage: 'typing',
      width: mirror.getBoundingClientRect().width
    })
  }

  handleTypingDone() {
    setTimeout(() => {
      this.setState({
        stage: 'done'
      })
    }, 1000)
  }

  render() {
    return (
      <div className={styles.container}>
        <div  className={classNames({
          [styles.hide]: this.state.stage !== 'typing'
        })} style={{ width: this.state.width }}>
          <Typist cursor={cursor} onTypingDone={this.handleTypingDone.bind(this)}>
            { this.props.text }
          </Typist>
        </div>
        <div ref="mirror" className={classNames({
          [styles.mirror]: true,
          [styles.hide]: this.state.stage === 'typing',
          [styles.show]: this.state.stage === 'done'
        })}>
          { this.props.text }
        </div>
      </div>
    )
  }
}

export default TypeCat
