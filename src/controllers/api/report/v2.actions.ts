import { type DatabaseBackend } from '../../../db/backend'

import * as mongoActions from './v2.mongo.actions'

export type V2Actions = typeof mongoActions

export const getV2Actions = (backend: DatabaseBackend): V2Actions => {
  if (backend === 'mongodb') {
    return mongoActions
  }

  throw new Error('PostgreSQL report v2 actions are not yet implemented')
}
