import { type DatabaseBackend } from '../../../db/backend'

import * as mongoActions from './v2.mongo.actions'
import * as postgresActions from './v2.postgres.actions'

export type V2Actions = typeof mongoActions

export const getV2Actions = (backend: DatabaseBackend): V2Actions => {
  if (backend === 'mongodb') {
    return mongoActions
  }

  return postgresActions
}
