import { type DatabaseBackend } from '../../../db/backend'

import * as mongoActions from './v3.mongo.actions'

export type V3Actions = typeof mongoActions

export const getV3Actions = (backend: DatabaseBackend): V3Actions => {
  if (backend === 'mongodb') {
    return mongoActions
  }

  throw new Error('PostgreSQL report v3 actions are not yet implemented')
}
