import { type DatabaseBackend } from '../../db/backend'

import * as mongoActions from './others.mongo.actions'
import * as postgresActions from './others.postgres.actions'

export type OtherActions = typeof mongoActions

export const getOtherActions = (backend: DatabaseBackend): OtherActions => {
  if (backend === 'mongodb') {
    return mongoActions
  }

  return postgresActions
}
