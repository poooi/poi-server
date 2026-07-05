# Koa to Fastify migration plan

## Goal

Replace Koa with Fastify while preserving the existing public HTTP contract, report ingestion semantics, Sentry metadata, and test coverage.

This migration must be implementation-ready: every phase below has concrete files, compatibility checks, and validation commands. Do not combine this with a Mongoose major upgrade.

## Current facts to preserve

- Runtime: Node.js `>=24`.
- Test runner: Vitest.
- Validation commands:
  - `npm run type-check`
  - `npm run lint`
  - `npm run test:unit`
  - `npm run test:e2e`
  - `npm test`
- Current HTTP stack:
  - `koa`
  - `@koa/router`
  - `koa-bodyparser`
  - `koa-cash`
  - `koa-pino-logger`
- Current app wiring:
  - `src/create-app.ts` creates a Koa app.
  - `src/server.ts` starts it with `app.listen(port, host)`.
  - `src/app.ts` logs `Koa is listening on port ...`.
- Current route groups:
  - `/api`
  - `/api/report/v2`
  - `/api/report/v3`
- Current report request shape:
  - outer body is expected to be an object containing `data`.
  - if `data` is a string, parse it as JSON.
  - malformed string `data` returns `400` with `{ "error": "data must be valid JSON" }`.
  - missing, null, array, or non-object report data returns `400` with `{ "error": "data must be a JSON object" }`.
- Current legacy route typos are public API and must stay:
  - `/api/report/v2/night_contcat`
  - `/api/report/v2/night_battle_ss_ci`
- Current GET cache call sites:
  - `GET /api/report/v2/known_quests`
  - `GET /api/report/v3/known_quests`
  - `GET /api/report/v3/item_improvement_recipes/availability`
  - `GET /api/report/v3/item_improvement_recipes/costs`
  - `GET /api/report/v3/item_improvement_recipes/updates`
- Current Sentry metadata:
  - IP from `cf-connecting-ip`, `true-client-ip`, `x-real-ip`, or `x-forwarded-for`.
  - reporter from `x-reporter` or `user-agent`.
  - Cloudflare metadata from `cf-ray` and `cf-ipcountry`.
  - version from `global.latestCommit?.slice(0, 8)`.
  - body context from outer body `data`.

## Locked technical decisions

1. Use Fastify v5.
   - Current checked target: `fastify@5.9.0`.
   - Fastify v5 supports Node.js 20+, so it is compatible with this repo's Node.js 24 requirement.

2. Do not add generic Fastify plugins unless a tested behavior requires them.
   - Add `fastify`.
   - Do not add `@fastify/sensible` initially.
   - Do not add `@fastify/compress` initially.
   - Do not add `@fastify/etag` initially.
   - Do not add `@fastify/caching` initially.

3. Keep Mongoose unchanged in this migration.
   - `mongoose@5` to `mongoose@9` changes DB behavior and must be a separate migration.

4. Split Sentry into two commits.
   - Commit 1: keep current Sentry package behavior and port the manual Koa middleware into Fastify hooks.
   - Commit 2: upgrade to current `@sentry/node` only after Fastify parity tests pass.
   - Current checked target for the second commit: `@sentry/node@10.63.0`.

5. Do not build a Koa compatibility shim.
   - No fake `ctx`.
   - No adapter pretending Fastify is Koa.
   - Extract small request/result helpers only where they enable unit tests.

6. Keep unsupported method behavior at `404`.
   - Existing e2e asserts `PUT /api/status` returns `404`.
   - Do not add automatic `405` behavior.

7. Preserve cache staleness semantics during migration.
   - Existing Koa cache has no explicit invalidation after report writes.
   - Fastify replacement must use the same TTL behavior first.
   - Cache invalidation can be a later feature, not part of this migration.

## Target dependency changes

Use the repo's existing npm/package-lock workflow.

Initial transport commit:

```bash
npm install fastify@5.9.0
npm uninstall koa @koa/router koa-bodyparser koa-cash koa-pino-logger @types/koa @types/koa__router @types/koa-bodyparser @types/koa-cash @types/koa-pino-logger
```

Sentry modernization commit, after transport parity:

```bash
npm install @sentry/node@10.63.0
npm uninstall @sentry/tracing
```

If npm resolves newer compatible versions during implementation, update this file in the same PR with the actual installed versions from `package-lock.json`.

## Target file layout

Create these files:

```text
src/http/cache.ts
src/http/result.ts
src/http/request.ts
src/http/fastify.ts
src/controllers/api/others.handlers.ts
src/controllers/api/others.fastify.ts
src/controllers/api/report/shared.ts
src/controllers/api/report/v2.handlers.ts
src/controllers/api/report/v2.fastify.ts
src/controllers/api/report/v3.handlers.ts
src/controllers/api/report/v3.fastify.ts
```

Update these files:

```text
src/create-app.ts
src/server.ts
src/app.ts
src/sentry.ts
src/controllers/index.ts
tests/item-improvement-recipe.test.ts
tests/sentry.test.ts
tests/server.e2e.test.ts
package.json
package-lock.json
```

Remove these files after all imports move:

```text
src/controllers/api/others.ts
src/controllers/api/report/v2.ts
src/controllers/api/report/v3.ts
```

## Exact internal HTTP types

Add `src/http/request.ts`:

```ts
import { type IncomingHttpHeaders } from 'node:http'

export interface AppRequest {
  body: unknown
  headers: IncomingHttpHeaders
  method: string
  params: Record<string, string | undefined>
  path: string
  query: Record<string, string | undefined>
  url: string
}

export const getHeader = (request: AppRequest, name: string): string => {
  const value = request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(',') : value || ''
}
```

Add `src/http/result.ts`:

```ts
export interface AppResult {
  body?: unknown
  headers?: Record<string, string>
  status: number
}

export const ok = (body?: unknown): AppResult => ({ body, status: 200 })
export const badRequest = (message: string): AppResult => ({
  body: { error: message },
  status: 400,
})
export const internalServerError = (): AppResult => ({ status: 500 })
```

Add `src/http/fastify.ts`:

```ts
import { type FastifyReply, type FastifyRequest } from 'fastify'

import { type AppRequest } from './request'
import { type AppResult } from './result'

export const toAppRequest = (request: FastifyRequest): AppRequest => ({
  body: request.body,
  headers: request.headers,
  method: request.method,
  params: request.params as Record<string, string | undefined>,
  path: request.url.split('?')[0] || request.url,
  query: request.query as Record<string, string | undefined>,
  url: request.url,
})

export const sendResult = (reply: FastifyReply, result: AppResult) => {
  for (const [name, value] of Object.entries(result.headers || {})) {
    reply.header(name, value)
  }
  return reply.code(result.status).send(result.body)
}
```

Only use these types for app-level route handlers. Do not create a larger framework abstraction.

## Exact report shared parser

Add `src/controllers/api/report/shared.ts`:

```ts
import { isString } from 'lodash'

import { getHeader, type AppRequest } from '../../../http/request'

export class ReportPayloadValidationError extends Error {}

export const getRequestData = (body: unknown) =>
  body != null && typeof body === 'object' && !Array.isArray(body) && 'data' in body
    ? (body as { data?: unknown }).data
    : undefined

export const parseJsonData = (data: unknown) => {
  if (!isString(data)) return data
  try {
    return JSON.parse(data)
  } catch {
    throw new ReportPayloadValidationError('data must be valid JSON')
  }
}

export const parseReportInfo = (request: AppRequest): Record<string, any> => {
  const data = parseJsonData(getRequestData(request.body))
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ReportPayloadValidationError('data must be a JSON object')
  }

  const info = data as Record<string, any>
  if (info.origin == null) {
    info.origin = getHeader(request, 'x-reporter') || getHeader(request, 'user-agent')
  }
  return info
}
```

Use this in both v2 and v3 handlers. Delete the duplicate Koa-specific parser code.

## Exact cache replacement

Add `src/http/cache.ts`:

```ts
import Cache from 'node-cache'

import { type AppRequest } from './request'
import { type AppResult } from './result'

interface CacheEntry {
  body: unknown
  headers?: Record<string, string>
  status: number
}

const cache = new Cache({
  checkperiod: 0,
  stdTTL: 10 * 60,
})

export const createCacheKey = (request: AppRequest) => `${request.method} ${request.url}`

export const getCachedResult = (request: AppRequest): AppResult | undefined => {
  const entry = cache.get<CacheEntry>(createCacheKey(request))
  return entry == null ? undefined : { ...entry }
}

export const setCachedResult = (request: AppRequest, result: AppResult): AppResult => {
  if (request.method === 'GET' && result.status === 200) {
    cache.set(createCacheKey(request), {
      body: result.body,
      headers: result.headers,
      status: result.status,
    })
  }
  return result
}

export const cached = async (
  request: AppRequest,
  resolve: () => Promise<AppResult>,
): Promise<AppResult> => {
  const hit = getCachedResult(request)
  if (hit != null) return hit
  return setCachedResult(request, await resolve())
}

export const clearResponseCacheForTests = () => {
  cache.flushAll()
}
```

Use this only at the five current `ctx.cashed()` call sites. Do not globally cache all GET routes.

## Fastify app construction

`src/create-app.ts` target behavior:

```ts
import Fastify from 'fastify'

import { config } from './config'
import { registerRoutes } from './controllers'
import { registerSentryHooks } from './sentry'

interface CreateAppOptions {
  disableLogger?: boolean
}

export const createApp = ({
  disableLogger = Boolean(config.disableLogger),
}: CreateAppOptions = {}) => {
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    logger: disableLogger ? false : true,
  })

  registerSentryHooks(app)

  app.setErrorHandler((err, request, reply) => {
    request.log.error(err)
    return reply.code(500).send()
  })

  void app.register(registerRoutes)

  return app
}
```

Implementation notes:

- `bodyLimit: 1024 * 1024` preserves the effective 1 MiB default.
- `genReqId` should prefer `x-request-id`, `x-correlation-id`, then Cloudflare `cf-ray`.
- Request logs should include Cloudflare `cf-ray`, `cf-ipcountry`, and client IP from Cloudflare headers before fallback proxy headers.
- Do not add response schemas in the first transport commit.
- Do not enable `ajv` route validation in the first transport commit.
- If malformed outer JSON behavior differs from Koa, add a Fastify error handler branch that returns the captured baseline status/body.

## Fastify route registration

`src/controllers/index.ts` target:

```ts
import { type FastifyPluginAsync } from 'fastify'

import { registerOtherApiRoutes } from './api/others.fastify'
import { registerReportV2Routes } from './api/report/v2.fastify'
import { registerReportV3Routes } from './api/report/v3.fastify'

export const registerRoutes: FastifyPluginAsync = async (app) => {
  await app.register(registerOtherApiRoutes, { prefix: '/api' })
  await app.register(registerReportV2Routes, { prefix: '/api/report/v2' })
  await app.register(registerReportV3Routes, { prefix: '/api/report/v3' })
}
```

Each `*.fastify.ts` file must be adapter-only:

```ts
app.post('/create_ship', async (request, reply) =>
  sendResult(reply, await createShip(toAppRequest(request))),
)
```

No business logic in `*.fastify.ts`.

## Server startup changes

`src/server.ts` target:

```ts
const app = createApp({ disableLogger })
await app.listen({ host, port })

return {
  server: app.server,
  close: () => app.close(),
}
```

Keep the return shape unchanged so existing e2e setup keeps working.

`src/app.ts` target log line:

```ts
console.log(`Fastify is listening on port ${config.port}`)
```

## Sentry phase 1: preserve existing SDK behavior

Replace Koa middleware with Fastify hooks in `src/sentry.ts`:

- `registerSentryHooks(app)` registers:
  - `onRequest`: start transaction and store it in a typed request decoration.
  - `onResponse`: set transaction status, tags, body context, then finish.
  - `onError`: call `captureException(err, request)`.
- `captureException` accepts `AppRequestLike`, not Koa `ParameterizedContext`.
- Preserve exported typo alias:
  - `sentryTracingMiddileaware`
  - Keep it only as a deprecated alias if any internal import remains.

Required request decoration:

```ts
declare module 'fastify' {
  interface FastifyRequest {
    sentryTransaction?: {
      finish: () => void
      setHttpStatus: (status: number) => void
      setName: (name: string) => void
    }
  }
}
```

Do not use `request.ip` for current metadata. Keep explicit header extraction from `x-real-ip` and `x-forwarded-for`.

## Sentry phase 2: modernize SDK

After Fastify parity is green:

1. Upgrade to `@sentry/node@10.63.0`.
2. Remove `@sentry/tracing`.
3. Use official Fastify integration only if it does not double-capture errors or drop current custom metadata.
4. Keep custom hooks for reporter/version/body context if the SDK integration does not provide them.
5. Add one test proving errors are captured exactly once.

## Route implementation checklist

### `/api`

| Route                        | Handler file         | Required behavior                                          |
| ---------------------------- | -------------------- | ---------------------------------------------------------- |
| `GET /status`                | `others.handlers.ts` | Query disk, count Mongo records, return JSON status.       |
| `POST /github-master-hook`   | `others.handlers.ts` | Spawn hook process, return `{ code: 0 }`. Body is ignored. |
| `GET /latest-commit`         | `others.handlers.ts` | Return `global.latestCommit` as text/string body.          |
| `GET /service-status-badge`  | `others.handlers.ts` | Return SVG and `Content-Type: image/svg+xml`.              |
| `GET /service-version-badge` | `others.handlers.ts` | Return SVG and `Content-Type: image/svg+xml`.              |

### `/api/report/v2`

| Route                              | Required behavior                                                      |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `POST /create_ship`                | Save one `CreateShipRecord`.                                           |
| `POST /create_item`                | Save one `CreateItemRecord`.                                           |
| `POST /remodel_item`               | Save one `RemodelItemRecord`.                                          |
| `POST /drop_ship`                  | Save one `DropShipRecord`; clear `ownedShipSnapshot` for `mapId < 73`. |
| `POST /select_rank`                | Upsert by `teitokuId` and `mapareaId`.                                 |
| `POST /pass_event`                 | Save one `PassEventRecord`.                                            |
| `GET /known_quests`                | Cached; return lexicographically sorted distinct quest IDs.            |
| `POST /quest/:id`                  | Legacy no-op, return `200`.                                            |
| `POST /battle_api`                 | Save one `BattleAPI`.                                                  |
| `POST /night_contcat`              | Preserve typo route; save one `NightContactRecord`.                    |
| `POST /aaci`                       | Preserve current version gate logic.                                   |
| `GET /known_recipes`               | Return current legacy shape.                                           |
| `POST /remodel_recipe`             | Preserve upsert and stage `-1` ignore behavior.                        |
| `POST /remodel_recipe_deduplicate` | Preserve duplicate removal behavior.                                   |
| `POST /night_battle_ci`            | Save one `NightBattleCI`.                                              |
| `POST /night_battle_ss_ci`         | Legacy no-op, return `200`.                                            |
| `POST /ship_stat`                  | Preserve upsert/count behavior.                                        |
| `POST /enemy_info`                 | Preserve bomber range merge behavior.                                  |

### `/api/report/v3`

| Route                                        | Required behavior                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /item_improvement_recipe`              | Preserve normalization, batch limit, concurrency, and `{ records }` response. |
| `GET /item_improvement_recipes/availability` | Cached; preserve cursor and projection excluding `origins`.                   |
| `GET /item_improvement_recipes/costs`        | Cached; preserve cursor and projection excluding `origins`.                   |
| `GET /item_improvement_recipes/updates`      | Cached; preserve cursor and projection excluding `origins`.                   |
| `GET /known_quests`                          | Cached; return quest key prefixes.                                            |
| `POST /quest`                                | Upsert quest records by hash/key.                                             |
| `POST /quest_reward`                         | Upsert quest reward by hash/key and selections.                               |

## Test changes before transport swap

Add these tests while Koa is still active:

### `tests/server.e2e.test.ts`

Add cases:

1. `POST /api/report/v2/create_ship` with malformed outer JSON.
   - Capture exact current status and response body.
   - Fastify must match it or intentionally document a breaking change.

2. `POST /api/report/v2/create_ship` with empty body.
   - Expected report parser response: `400 { error: 'data must be a JSON object' }`, unless baseline says bodyparser intercepts first.

3. `POST /api/github-master-hook` with no JSON body.
   - Must still return `200 { code: 0 }`.

4. `HEAD /api/status`.
   - Capture current status.
   - Fastify must match or add explicit route handling.

5. Repeated query params:
   - Drop the old Koa first-value array behavior.
   - Use Fastify's default parser behavior for duplicate keys.

6. Cache hit/miss:
   - First `GET /api/report/v3/known_quests`.
   - Insert a quest directly.
   - Second `GET` returns cached first response within TTL.
   - This preserves current no-invalidation behavior.

### `tests/sentry.test.ts`

Add cases:

1. IP priority:
   - `x-real-ip` beats `x-forwarded-for`.
2. Reporter priority:
   - `x-reporter` beats `user-agent`.
3. Transaction name:
   - method + route path, without query string.
4. Status:
   - response status is passed to Sentry.
5. Body context:
   - object `data` stays object.
   - array/string `data` is wrapped as `{ data }`.
6. Error capture:
   - captured once for a thrown route error.

### `tests/item-improvement-recipe.test.ts`

Replace Koa router stack introspection with direct handler tests:

- Import handlers from `v3.handlers.ts`.
- Build `AppRequest` fixtures.
- Assert `AppResult` status/body and mocked model calls.

## Test changes after Fastify transport swap

Add `app.inject()` tests for route adapters:

```text
tests/fastify-routes.test.ts
```

Required cases:

1. All routes are registered under the same paths.
2. Headers reach handler helpers.
3. Query params reach cursor parser.
4. JSON body reaches report parser.
5. SVG routes set `image/svg+xml`.
6. Unsupported methods remain `404`.
7. Unknown routes remain `404`.

Keep `tests/server.e2e.test.ts` as real HTTP coverage. Do not replace it with `app.inject()`.

## Phase-by-phase implementation sequence

### Phase 0: baseline

Commands:

```bash
npm run type-check
npm run lint
npm run test:unit
npm run test:e2e
npm test
```

Stop if baseline fails for reasons unrelated to this migration.

### Phase 1: add compatibility tests

Files:

```text
tests/server.e2e.test.ts
tests/sentry.test.ts
```

Commands:

```bash
npm run test:e2e
npm run test:unit
```

Commit message:

```text
test: lock koa http compatibility before fastify migration
```

### Phase 2: extract report/common handlers under Koa

Files:

```text
src/http/request.ts
src/http/result.ts
src/controllers/api/report/shared.ts
src/controllers/api/report/v2.handlers.ts
src/controllers/api/report/v3.handlers.ts
src/controllers/api/report/v2.ts
src/controllers/api/report/v3.ts
tests/item-improvement-recipe.test.ts
```

Rules:

- Keep existing Koa routes working.
- Koa files become adapters.
- Unit tests target handler files, not Koa router internals.

Commands:

```bash
npm run type-check
npm run test:unit
```

Commit message:

```text
refactor: extract report handlers from koa routes
```

### Phase 3: extract common `/api` handlers under Koa

Files:

```text
src/controllers/api/others.handlers.ts
src/controllers/api/others.ts
```

Commands:

```bash
npm run type-check
npm run test:unit
npm run test:e2e
```

Commit message:

```text
refactor: extract common api handlers from koa routes
```

### Phase 4: add Fastify and switch transport

Files:

```text
package.json
package-lock.json
src/http/fastify.ts
src/http/cache.ts
src/create-app.ts
src/server.ts
src/app.ts
src/controllers/index.ts
src/controllers/api/others.fastify.ts
src/controllers/api/report/v2.fastify.ts
src/controllers/api/report/v3.fastify.ts
src/sentry.ts
tests/fastify-routes.test.ts
```

Commands:

```bash
npm install fastify@5.9.0
npm uninstall koa @koa/router koa-bodyparser koa-cash koa-pino-logger @types/koa @types/koa__router @types/koa-bodyparser @types/koa-cash @types/koa-pino-logger
npm run type-check
npm run lint
npm run test:unit
npm run test:e2e
npm test
```

Commit message:

```text
feat: replace koa transport with fastify
```

### Phase 5: remove old Koa files and imports

Files:

```text
src/controllers/api/others.ts
src/controllers/api/report/v2.ts
src/controllers/api/report/v3.ts
```

Commands:

```bash
npm run type-check
npm run lint
npm test
```

Commit message:

```text
chore: remove koa route modules
```

### Phase 6: modernize Sentry SDK

Files:

```text
package.json
package-lock.json
src/sentry.ts
src/sentry-bootstrap.ts
tests/sentry.test.ts
tests/server.e2e.test.ts
```

Commands:

```bash
npm install @sentry/node@10.63.0
npm uninstall @sentry/tracing
npm run type-check
npm run lint
npm run test:unit
npm run test:e2e
npm test
```

Commit message:

```text
chore: update sentry integration for fastify
```

## Final acceptance criteria

The migration is complete only when all of these are true:

- No dependency on `koa`, `@koa/router`, `koa-bodyparser`, `koa-cash`, or `koa-pino-logger`.
- `npm run type-check` passes.
- `npm run lint` passes.
- `npm run test:unit` passes.
- `npm run test:e2e` passes.
- `npm test` passes.
- All existing public route paths still work.
- Unsupported methods still return `404`.
- Existing report validation error messages are unchanged.
- Sentry receives the same IP, reporter, version, status, transaction name, and body context.
- Cache behavior is explicitly tested and unchanged.

## Rubber-duck convergence log

### Question: Why not migrate controllers directly from `ctx` to `request/reply`?

Rejected. That would make unit tests depend on Fastify objects and repeat the same router-internals mistake currently present with Koa. The converged design uses pure handler functions plus tiny Fastify adapters.

### Question: Why not create a fake Koa `ctx` on top of Fastify?

Rejected. It would preserve the worst part of the current design and hide Fastify semantics. The migration should remove Koa concepts, not emulate them.

### Question: Why not use `@fastify/caching`?

Rejected for the first transport commit. Current code uses `ctx.cashed()` only in five specific GET handlers. A tiny explicit cache helper is easier to test and less likely to alter response headers or cache eligibility.

### Question: Should report POST writes invalidate cached GETs?

No, not in this migration. Existing code does not explicitly invalidate `koa-cash`. Preserve current TTL staleness first; add invalidation later only as an intentional behavior change.

### Question: Should Sentry and Fastify migrate in one step?

Partially. Fastify requires Sentry hook changes, but the SDK major upgrade should happen after transport parity is proven. This prevents debugging Fastify and Sentry v10 regressions at the same time.

### Question: Should Mongoose be updated because the stack should be modern?

No. Mongoose is a DB behavior migration, not an HTTP transport migration. Keeping it stable makes failures attributable to Fastify. Modernization continues with Sentry because it is directly coupled to HTTP instrumentation.

### Question: Should Zod/Fastify schemas be added to every route now?

No. The current API has hand-written validation and legacy error strings. Add schemas only after parity, route by route, with tests proving no client-visible error drift.

### Question: What is the riskiest compatibility point?

Malformed request bodies. Koa bodyparser and Fastify JSON parser may produce different status/body for invalid outer JSON. Capture current behavior in e2e before switching, then either match it or explicitly document the breaking change.

### Question: What is the second riskiest compatibility point?

Sentry duplication or metadata loss. Fastify hooks and Sentry SDK integration can both capture errors. Tests must prove exactly one capture and preserve current tags/context.

### Question: What is the third riskiest compatibility point?

Query parsing for cursor exports. The current code accepts array query values and uses the first value. Add a repeated-query contract test before switching transport.

### Question: What proves this plan is implementation-ready?

Every phase names files, code shapes, tests, commands, and commit boundaries. There are no optional plugins or unresolved framework choices in the transport migration.
