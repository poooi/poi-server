import { type DatabaseBackend } from '../../../db/backend'

import * as mongoActions from './v3.mongo.actions'
import * as postgresActions from './v3.postgres.actions'

export type V3Actions = typeof mongoActions

export const getV3Actions = (backend: DatabaseBackend): V3Actions => {
  if (backend === 'mongodb') {
    return mongoActions
  }

  return postgresActions
}
