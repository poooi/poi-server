import React from 'react'
import classNames from 'classnames'

import metadata from '../../intl/metadata'
import styles from './styles'

class Header extends React.Component {
  switchLanguage(lang) {
    return this.context.switchLanguage(lang)
  }

  render() {
    return (
      <div className={styles.header}>
        <div className={styles.languages}>
          { Object.keys(metadata).map(lang => (
            <a key={lang}
               onClick={this.switchLanguage.bind(this, lang)}
               className={classNames({
                 [styles.active]: this.context.locale === lang
               })}>
              { metadata[lang] }
            </a>
          )) }
        </div>
      </div>
    )
  }
}

Header.contextTypes = {
  router: React.PropTypes.object,
  switchLanguage: React.PropTypes.func,
  locale: React.PropTypes.string
}

export default Header
