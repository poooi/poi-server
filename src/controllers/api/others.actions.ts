import { type DatabaseBackend } from '../../db/backend'

import * as mongoActions from './others.mongo.actions'

export type OtherActions = typeof mongoActions

export const getOtherActions = (backend: DatabaseBackend): OtherActions => {
  if (backend === 'mongodb') {
    return mongoActions
  }

  throw new Error('PostgreSQL status actions are not yet implemented')
}
