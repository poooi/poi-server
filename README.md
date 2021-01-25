# poi-server

![service status](https://api.poi.moe/api/service-status-badge)
![service version](https://api.poi.moe/api/service-version-badge)

poi server.

## Usage

See the [wiki](https://github.com/poooi/poi-server/wiki).

## Development

### Prerequists:

- Node.js 14.x
- MongoDB v4.2

Other versions are not tested

### Setup

- Install dependencies with npm install
- copy `.env.example` to create `.env`, this contains config file for the server
- start mongodb, if the db path or port is different, specify them in the `.env` file
- start the server by `node index.js`
