# poi-server

![service status](https://api.poi.moe/api/service-status-badge)
![service version](https://api.poi.moe/api/service-version-badge)

poi server.

## Usage

See the [wiki](https://github.com/poooi/poi-server/wiki).

## Development

### Prerequists:

- Node.js 24+
- MongoDB v4.2

Other versions are not tested

### Setup

- Install dependencies with npm install
- copy `.env.example` to create `.env`, this contains config file for the server
- set `POI_SERVER_DATABASE_URL` to the active database connection string; `POI_SERVER_DB` remains as a
  backward-compatible fallback
- start MongoDB, if the db path or port is different, specify it in the `.env` file
- start the server by `node index.js`
- `npm run test:e2e` expects a local MongoDB e2e database URI from `POI_SERVER_DATABASE_URL` or
  `POI_SERVER_DB`; CI provides `mongodb://127.0.0.1:27017/poi-e2e`
