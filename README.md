# IBKR Backend Service

Node.js and Express backend for the Interactive Brokers Web API. It handles OAuth authentication, brokerage sessions, market-data snapshots, historical bars, instrument search, and contract details. Redis provides shared request pacing and a short-lived instrument-search cache.

The frontend is still to be built. A browser helper is included for autocomplete, but there is no dropdown, chart, or WebSocket stream served by this application yet. Live IBKR verification is pending credentials; the current verification uses simulated IBKR responses and local Redis integration tests.

## Contents

- [Running locally](#running-locally)
- [API overview](#api-overview)
- [Authentication and brokerage sessions](#authentication-and-brokerage-sessions)
- [Quote snapshots](#quote-snapshots)
- [Historical bars](#historical-bars)
- [Instrument search](#instrument-search)
- [Autocomplete and search caching](#autocomplete-and-search-caching)
- [Instrument details](#instrument-details)
- [Using the endpoints together](#using-the-endpoints-together)
- [Errors and response conventions](#errors-and-response-conventions)
- [Code layout](#code-layout)
- [Verification and remaining work](#verification-and-remaining-work)
- [Redis pacing](#redis-pacing)

## Running locally

Development uses Node.js 22, npm, and Redis. IBKR calls also need the OAuth application credentials and account access configured for that application.

```sh
npm ci
```

Create a local `.env` file. The values below are placeholders; use the base URLs and credentials supplied for your IBKR integration.

```dotenv
PORT=3000
REDIS_URL=redis://127.0.0.1:6379
IBKR_RATE_LIMIT_SCOPE=local-ibkr

IBKR_CLIENT_ID=your-client-id
IBKR_CLIENT_KEY_ID=your-key-id
IBKR_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_CONTENT\n-----END PRIVATE KEY-----"
IBKR_OAUTH_BASE_URL=https://your-oauth-host.example
IBKR_GATEWAY_BASE_URL=https://your-session-host.example
IBKR_CLIENT_IP=your-registered-client-ip
IBKR_CREDENTIAL=your-ibkr-credential
IBKR_SCOPE=sso-sessions.write
```

The OAuth and session base URLs must use HTTPS. The code appends `/api/v1/token` and `/api/v1/sso-sessions` respectively, so do not include those paths in the base values. Brokerage calls use `https://api.ibkr.com/v1/api`. `PORT` defaults to `3000`; `IBKR_SCOPE` defaults to `sso-sessions.write`.

Keep `.env` and private keys out of Git. The private-key loader accepts literal `\n` sequences and converts them to newlines. The session token stays in the backend; the API does not return it to the browser.

If Redis is not already running, the repository includes a local Compose configuration:

```sh
docker compose -f compose.redis.yml up -d
node scripts/checkRedis.js
npm run dev
```

Use `npm start` to run without file watching. The server checks Redis before opening its HTTP port. A running server does not by itself confirm that IBKR credentials or brokerage access are ready.

```sh
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/auth/connect
curl http://localhost:3000/api/auth/status
```

These routes currently use the backend's configured IBKR identity. There is no separate application-user login or route authorization layer, and CORS currently allows browser origins generally. This is not yet a multi-user account-isolation design.

## API overview

All paths below are relative to the backend host.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Server liveness; does not check IBKR readiness |
| POST | `/api/auth/connect` | Obtain/reuse an SSO session and request brokerage initialization |
| GET | `/api/auth/status` | Obtain/reuse an SSO session and read brokerage readiness |
| GET | `/api/marketdata/live?conid=265598` | Return one quote snapshot |
| GET | `/api/marketdata/history?conid=265598&period=1d&bar=5min` | Return historical OHLCV bars |
| GET | `/api/instruments/search?q=AAPL&mode=symbol&limit=10` | Search and rank instrument candidates |
| GET | `/api/instruments/265598` | Return metadata for the selected contract |

A `conid` is IBKR's contract identifier. Search accepts a human-readable symbol or company name; the selected result supplies the ID used for details, quotes, and history. Contract IDs must be positive integers within JavaScript's safe integer range, without leading zeros.

## Authentication and brokerage sessions

The authentication service signs an RS256 client assertion to obtain an OAuth access token. It then signs a session assertion and uses the OAuth token to obtain an SSO session token. Subsequent brokerage requests use that SSO token as a bearer token.

```text
Request reaches ensureIBKRSession
        ↓
Cached SSO token available? ── yes ──→ Reuse it
        │ no
        ↓
Session creation already running? ── yes ──→ Await the same promise
        │ no
        ↓
Sign client assertion → POST /api/v1/token
        ↓
Sign session assertion → POST /api/v1/sso-sessions
        ↓
Cache SSO token in this process and start keep-alive
        ↓
Store token in res.locals.ibkrSessionToken
        ↓
Continue to the requested controller
```

Token reuse avoids authenticating on every request. Concurrent requests in the same process share one session-creation promise. This coordination is local to the process, not stored in Redis.

An SSO token alone does not establish that brokerage access is ready. Connecting also requests initialization:

```text
POST /api/auth/connect
        ↓
Obtain or reuse the SSO session token
        ↓
POST /iserver/auth/ssodh/init
Body: { publish: true, compete: false }
        ↓
POST /iserver/auth/status
        ↓
Return status and ready flag
```

The `ready` flag requires `authenticated`, `connected`, and `established` to be true, and `competing` to be false. Initialization can return HTTP 200 with `ready: false`; the caller must inspect that flag.

`GET /api/auth/status` calls the same upstream status endpoint without initializing brokerage. Its session middleware can still create an SSO token when none is cached. The service accepts both a direct status response and the documented `success.value` wrapper.

Keep-alive sends `POST /tickle` every 60 seconds while a cached session exists. There is one timer per process, overlapping pings are skipped, and the timer does not create new sessions. A delayed response from an older token is ignored if the cached token has changed. Brokerage HTTP 401 clears the matching cached token and returns a reconnect message; the original request is not automatically replayed.

## Quote snapshots

```http
GET /api/marketdata/live?conid=265598
```

Despite its name, `/live` returns a snapshot. It does not maintain a stream or push later updates to the client. Data availability and freshness depend on the IBKR session and market-data access.

```text
Validate conid
        ↓
Obtain the SSO session token
        ↓
POST /iserver/auth/status → Reject with 503 if brokerage is not ready
        ↓
GET /iserver/accounts
        ↓
GET /iserver/marketdata/snapshot?conids=...&fields=31,84,86,6509
        ↓
Find the requested contract and map the quote fields
        ↓
At least one price available? ── yes ──→ Return the partial/full quote
        │ no
        ↓
Wait one second and request another snapshot
        ↓
After three snapshot attempts without prices → Return 503
```

Every upstream brokerage call passes through the shared request helper and Redis pacing. The snapshot warm-up loop handles successful responses that have no prices yet; HTTP failures are not automatically retried by that loop.

| IBKR field | Response field | Meaning |
| --- | --- | --- |
| `31` | `lastPrice` | Last price |
| `84` | `bid` | Bid price |
| `86` | `ask` | Ask price |
| `_updated` | `updatedAt` | Upstream update value |
| `6509` | `marketDataAvailability` | Upstream availability code |

Missing prices become `null`. Available price values are preserved as returned by IBKR; they are not forcibly converted to numbers. One available price is enough to return a successful partial quote.

## Historical bars

```http
GET /api/marketdata/history?conid=265598&period=1d&bar=5min&outsideRth=false
```

`period` controls the requested lookback. `bar` controls the interval represented by each candle. Each bar contains open, high, low, close, and volume (OHLCV). `outsideRth` requests data outside regular trading hours when true and defaults to false.

The backend currently accepts this subset of combinations:

| Period | Accepted bar values |
| --- | --- |
| `1d` | `1min`, `2min`, `3min`, `5min`, `10min`, `15min`, `30min`, `1h`, `2h`, `3h`, `4h`, `8h` |
| `1w` | `10min`, `15min`, `30min`, `1h`, `2h`, `3h`, `4h`, `8h`, `1d`, `1w` |
| `1m` | `1h`, `2h`, `3h`, `4h`, `8h`, `1d`, `1w`, `1m` |
| `1y` | `8h`, `1d`, `1w`, `1m` |

`1m` means one month; minutes use `min`. `conid`, `period`, and `bar` are required. Unknown parameters, repeated values, incompatible combinations, and values other than the literal strings `true`/`false` for `outsideRth` are rejected before authentication. Acceptance by this validator does not guarantee data exists for every contract and interval.

```text
Validate history query
        ↓
Obtain SSO token → Check brokerage readiness
        ↓
Pass through Redis pacing
        ↓
GET /iserver/marketdata/history
Parameters: conid, period, bar, outsideRth, source=Last
        ↓
Validate the response and each bar
        ↓
Map t/o/h/l/c/v → timestamp/open/high/low/close/volume
        ↓
Sort bars by timestamp and return bars with metadata
```

There is one history call after the readiness check, with no `/iserver/accounts` preflight and no automatic retry. Invalid bar values cause an upstream-response error rather than silently dropping candles. An empty bar array remains a valid result.

The returned `data` object contains `conid`, `symbol`, `name`, `period`, `bar`, `barSource`, `outsideRth`, `barCount`, `metadata`, and `bars`. Metadata retains `timePeriod`, `barLength`, `outsideRth`, `startTime`, `mdAvailability`, `mktDataDelay`, `priceFactor`, `volumeFactor`, and `points`, using null for missing values.

Timestamps, prices, and volume are not rescaled. The response keeps IBKR's factors alongside the bars so a consumer can interpret them rather than assume the backend has already applied a conversion. Missing volume becomes null. Historical availability metadata is separate from the snapshot availability field.

## Instrument search

```http
GET /api/instruments/search?q=AAPL&mode=symbol&limit=10
GET /api/instruments/search?q=Interactive%20Brokers&mode=name&limit=10
```

| Parameter | Rules |
| --- | --- |
| `q` | Required text, 1–64 characters after trimming; control characters are rejected |
| `mode` | `symbol` (default) or `name` |
| `limit` | Integer from 1 to 20; defaults to 10 |

Unknown and repeated parameters are rejected. Symbol input is uppercased; company-name input preserves its spelling and case. Punctuation is treated literally rather than as a regular expression.

The upstream request is `GET /iserver/secdef/search`. Symbol mode sends `symbol=<q>&pattern=true`; company-name mode sends `symbol=<q>&name=true`. IBKR exposes the pattern flag without a clear guarantee of exhaustive prefix matching. Its actual effect and one-letter search coverage still need live verification. The backend cannot recover matching instruments that IBKR did not return.

Search results are normalized to:

```json
{
  "conid": "43645865",
  "symbol": "IBKR",
  "name": "INTERACTIVE BROKERS GRO-CL A (NASDAQ)",
  "exchange": null
}
```

This illustrates the normalized form of IBKR's documented company-name example, not a captured live response. `companyName` maps to `name`, and `description` maps to `exchange`. Contract IDs become strings, optional text is trimmed, and missing text becomes null. Exchange names are not extracted from company-name text. Malformed IDs, objects, or text fields reject the response with 502.

The backend then applies its own dropdown rules:

- Symbol mode keeps symbols beginning with the query; company-name mode keeps names containing it. Comparisons ignore case.
- Exact matches come first, followed by prefix matches, then other name matches. Matches within each group sort alphabetically; ties retain upstream order.
- Repeated contract IDs are removed. Different IDs with the same symbol remain separate candidates.
- Ranking runs before results are capped at 20; each caller's requested limit is applied afterward.

The response envelope is `{ success: true, source: "ibkr", data: { query, mode, results } }`. No matches returns `results: []`, not an error.

## Autocomplete and search caching

`examples/instrumentSearch.client.js` exports `createInstrumentSearchClient`. It supplies request behavior for the future UI; Express does not serve it as a page or render a dropdown.

```text
User changes the search text → client.update(text, mode)
        ↓
Clear old suggestions, cancel timer, abort older browser request
        ↓
Empty input? → Stop
        ↓
Wait for a 300 ms pause in typing
        ↓
Honor any active Retry-After pause
        ↓
GET /api/instruments/search?q=...&mode=...&limit=10
        ↓
Ignore responses belonging to older input
        ↓
Call onResults(results), onError(error), and onLoading(state)
```

Typing A → AA → AAP → AAPL quickly can produce just one request for AAPL. Pausing more than 300 ms between characters can produce a request for each intermediate query. Aborting a browser request does not guarantee that already-started backend or IBKR work stops. A sequence counter prevents late results from overwriting newer suggestions even if cancellation races with the response. Call `dispose()` when the consuming component is removed.

For 429/503 responses with a valid numeric `Retry-After`, the helper pauses further searches. It does not automatically submit another search when the pause expires; a later `update()` is needed.

The backend uses both Redis caching and an in-process map of pending searches:

```text
Validate input → Obtain SSO token → Build search key
        ↓
Identical search pending in this process? ── yes ──→ Await its result
        │ no
        ↓
Register pending work (maximum 100 distinct searches)
        ↓
Read Redis search cache
        ├── Valid hit → Apply caller's limit → Respond
        └── Miss
             ↓
        Redis pacing → IBKR search
             ↓
        Normalize → Filter → Deduplicate → Rank → Keep up to 20
             ↓
        Cache results → Apply caller's limit → Respond
```

Cache behavior:

| Property | Current behavior |
| --- | --- |
| Successful nonempty results | Cached for 300 seconds |
| Empty results | Cached for 30 seconds |
| Failed upstream requests | Not cached |
| Entry size | At most 20 results and 32 KiB of serialized data |
| Cache identity | Scope plus SHA-256 of session token, search mode, and uppercased query |
| Result limit | Excluded from the key so callers with different limits can share results |
| Corrupt cache value | Treated as a miss |
| Redis read failure | Return 503 without sending the search to IBKR |
| Redis write failure | Return the fetched results and log a sanitized warning |

The key format is `ibkr:instruments:{scope}:search:v2:<digest>`. The raw token is not stored in the key or cached result. A new token gets separate entries. Longer prefixes use separate queries and keys rather than filtering a previous, potentially truncated result set.

Matching requests share one promise only within the same backend process. Other processes can reuse Redis results, but simultaneous cache misses in different processes can still send separate paced IBKR requests. Cache hits avoid an upstream search and its pacing admission; they do not verify brokerage readiness.

The scope currently comes from `IBKR_RATE_LIMIT_SCOPE`. Its braces also place all keys in that scope into one slot if Cluster support is added. That grouping is needed for related pacing keys but is unnecessary for independent cache entries. Removing the cache hash tag has been discussed but is not implemented. The current Redis connection is a standalone client, not a Cluster deployment setup.

## Instrument details

```http
GET /api/instruments/265598
```

Use the selected search result's `conid` to load chart labels and contract metadata. This endpoint accepts no query parameters.

```text
GET /api/instruments/:conid
        ↓
Validate the contract ID
        ↓
Obtain the existing IBKR session, or create one if needed
        ↓
Pass through the shared Redis rate limiter
        ↓
GET /iserver/contract/{conid}/info
        ↓
Check the returned contract ID and normalize the response
        ↓
Return consistent JSON to the frontend
```

| Response field | IBKR source |
| --- | --- |
| `conid` | `con_id` or `conid`, returned as a string |
| `symbol` | `symbol` or `ticker` |
| `name` | `company_name` or `companyName` |
| `securityType` | `instrument_type` or `secType` |
| `currency` | `currency` |
| `listingExchange` | `listingExchange` |
| `exchange` | `exchange` |
| `validExchanges` | `valid_exchanges` or `validExchanges`, split into a trimmed, deduplicated array |

Both naming styles appear in IBKR's documentation. Missing optional text becomes null; missing valid exchanges becomes an empty array. Every supplied contract-ID alias must match the requested ID. A missing/wrong ID or invalid field type returns 502.

`listingExchange` and `exchange` are separate: SMART routing is not a primary listing venue. The backend does not infer a listing exchange from the list of available venues. These fields do not establish account permissions or subscription entitlements.

Details currently makes one upstream call per successful admission. There is no details cache, snapshot preflight, or automatic retry. It returns metadata, not prices or a trading schedule.

## Using the endpoints together

The intended frontend flow is:

```text
Connect brokerage → Confirm ready: true
        ↓
Search a symbol or company → Show instrument candidates
        ↓
Select a candidate → Retain its conid
        ├── Instrument details → Name, currency, security type, exchanges
        ├── Quote snapshot    → Last price, bid, ask, availability
        └── Historical bars  → OHLCV data for the chart
```

Each branch is a separate HTTP request. Search and details obtain a session but do not perform the explicit brokerage-readiness check used by snapshots and history. Their success should not be treated as proof that market-data access is ready.

## Errors and response conventions

Market-data and instrument endpoints use:

```json
{
  "success": true,
  "source": "ibkr",
  "data": {}
}
```

Authentication endpoints return `success`, `ready`, and `status` at the top level; connect also returns a message. Errors use:

```json
{
  "success": false,
  "message": "Provide one valid conid, for example ?conid=265598"
}
```

| HTTP status | Typical cause |
| --- | --- |
| 400 | Invalid client input, or IBKR rejection of a historical-data query |
| 429 | Shared request limit, active cooldown, or an upstream rate-limit response |
| 502 | Upstream communication failure, denied access, unreadable JSON, or malformed data |
| 503 | Brokerage not ready, expired session, unavailable Redis, unavailable quote prices, or too many pending searches |
| 504 | Brokerage request timeout |

The shared brokerage wrapper sanitizes upstream failures rather than forwarding raw error bodies. It sets a ten-second timeout after pacing admission and does not replay failed requests automatically. OAuth and SSO calls also have ten-second fetch timeouts but use their own authentication error handling.

The error middleware includes `Retry-After` when a 429/503 error supplies a valid positive delay. CORS exposes that header to browser clients. Receiving HTTP 200 does not imply a complete quote, live rather than delayed data, or a ready brokerage session; inspect the endpoint's returned fields.

Contract-ID representation currently differs by endpoint: search/details return strings, history returns a number, and snapshots retain the upstream ID value. Consumers should not rely on strict type equality across those responses without normalizing the ID.

## Code layout

| Location | Responsibility |
| --- | --- |
| `src/index.js`, `src/server.js` | Load configuration, start the server, check Redis, handle shutdown |
| `src/app.js` | Express middleware, health endpoint, route mounting, error handler |
| `routes/` | Public URL paths and middleware order |
| `middleware/` | Validate requests, obtain the IBKR session, format errors |
| `validation/` | Contract-ID and search/history query rules |
| `controllers/` | Read validated input/session context, call services, send response envelopes |
| `services/ibkrAuth.service.js` | OAuth, SSO token reuse, brokerage GET/POST requests, readiness and keep-alive |
| `services/marketData.service.js` | Snapshot readiness, accounts preflight, quote warm-up and mapping |
| `services/historicalMarketData.service.js` | Historical request and OHLCV normalization |
| `services/instrument.service.js` | Search-result normalization and retained earlier search service |
| `services/instrumentAutocomplete.service.js` | Active search service, filtering, ranking, concurrent request reuse |
| `services/instrumentSearchCache.service.js` | Search cache keys, validation, reads and expiry |
| `services/instrumentDetails.service.js` | Contract-details request and normalization |
| `services/redis.service.js`, `services/ibkrRedisPacing.service.js`, `redis/` | Redis lifecycle and shared pacing |
| `examples/instrumentSearch.client.js` | Browser autocomplete request helper |
| `scripts/` | Redis connectivity and cooldown-recovery utilities |

For example, a details request passes through `routes/instrument.routes.js`, `middleware/instrumentDetailsValidation.middleware.js`, `middleware/ibkrSession.middleware.js`, `controllers/instrumentDetails.controller.js`, and `services/instrumentDetails.service.js`, which calls the shared request helper. `/search` is registered before `/:conid` so the word "search" is not treated as an ID.

## Verification and remaining work

Local checks cover validation, normalization, concurrent request reuse, cache expiry, stale browser responses, and HTTP error propagation. Integration checks use the real Express application and Redis with simulated IBKR authentication and brokerage responses. They do not establish that a real account has access to a contract or subscription.

```sh
npm test
```

Redis integration checks can be enabled in PowerShell:

```powershell
$env:RUN_REDIS_TESTS = '1'
npm test
```

The integration suites default to local Redis on port 6379; `TEST_REDIS_URL` can select a test instance. The test directories are currently excluded by `.gitignore`, so a fresh GitHub clone will not contain the local suites. Running `npm test` in that clone does not reproduce the local coverage. Docker outage/restart checks have a separate opt-in.

Still to build or verify:

- Live IBKR authentication, response shapes, data access, and search-pattern behavior.
- Trading hours and schedules.
- WebSocket market-data subscriptions and delivery to the future frontend.
- React search UI and a live chart using Liveline.
- Independent distribution of search-cache keys if moving to Redis Cluster.

## Redis pacing

### Moving from process memory to Redis

This moves the IBKR rate limiter from process memory to Redis. Previously, each Node.js process kept its own request counters and cooldown, so multiple processes could exceed the shared allowance even when each stayed within its local limit. Restarting the backend also cleared its pacing state.

Redis now stores that state for all processes using the same allowance. The original implementation in services/ibkrPacing.service.js is kept for reference; brokerage requests use the new Redis limiter.

### Redis setup

Added services/redis.service.js to handle configuration, connections, connectivity checks, and cleanup. It uses one shared connection per process, and concurrent callers reuse the same connection attempt.

REDIS_URL sets the connection address. IBKR_RATE_LIMIT_SCOPE identifies the allowance being shared. Processes using the same allowance must use the same scope and Redis database. Both settings are validated before connecting.

Connection setup and commands have separate five-second deadlines. Offline command queues and automatic reconnection are disabled. After a failure, a later request can make a new connection attempt.

Also added:

scripts/checkRedis.js to check connectivity with PING without starting the application.
compose.redis.yml for local Redis setup, including a persistent volume, append-only persistence, a health check, and a port bound to localhost. It uses noeviction so Redis does not remove limiter keys to make room for other data.

### Rate limiting

Added services/ibkrRedisPacing.service.js with checkRequestLimit(path) and blockRequests(seconds).

The limits remain 10 brokerage requests per rolling second and 50 history requests per rolling minute. A history request counts toward both limits. Rejected requests do not use either allowance.

redis/checkRequestLimit.lua checks the limits and records an allowed request in one operation. This prevents separate backend processes from checking the same available slot and both taking it. Request records are stored in sorted sets, using Redis time and unique request IDs so simultaneous requests are counted separately. Old records are removed, and inactive keys expire.

When a limit is reached, the service returns 429 with a Retry-After value rounded up to whole seconds. redis/extendCooldown.lua handles shared cooldowns and only extends an existing block; a shorter cooldown cannot replace a longer one.

If Redis fails or times out, the service returns 503 and does not send the brokerage request. It does not fall back to local counters or automatically retry an uncertain Redis operation, since Redis may already have recorded it. Allowed attempts are also not refunded if the later IBKR request fails.

### Brokerage integration

The brokerage GET/POST wrapper in services/ibkrAuth.service.js now waits for Redis approval before calling fetch. This covers market data, accounts, brokerage status and initialization, and background /tickle calls. OAuth token and SSO-session creation remain outside this wrapper.

The ten-second IBKR timeout starts after Redis approves the request. If IBKR returns 429, the service stores a shared cooldown using its valid Retry-After value, or 900 seconds when no valid value is available.

If saving the cooldown fails, the request returns 503. The process remembers the remaining cooldown and must save it successfully before allowing another brokerage request. The upstream response body is still cleaned up when this happens.

Added src/server.js and updated src/index.js to check Redis before starting Express. The server will not start if Redis is unavailable or its configuration is missing.

On shutdown, the application stops accepting new HTTP requests and scheduling keep-alive calls, gives existing HTTP requests up to 30 seconds to finish, then closes Redis. Late work cannot reopen Redis or restart the keep-alive timer. The existing /health endpoint remains a liveness check.

### Testing and recovery

Testing covered requests from separate processes, shared cooldowns, Redis outages, and restarts. A timeout issue was fixed so Redis operations cannot leave requests waiting indefinitely. Added scripts/restoreRedisCooldown.js for manually restoring a cooldown after Redis data loss, with brokerage traffic stopped during recovery. Recorded results were 55 passing regular tests and a separate recovery run covering five passing scenarios. IBKR calls were mocked; live verification is still pending credentials.

### Deployment notes

Redis is now required to run the application. Stop processes still using the old local limiter when deploying this change.

Include the redis/ directory in the deployment, since the service loads the Lua files from there.

The current Git ignore rules exclude the local test directories and personal Redis implementation notes.

Redis data loss still needs manual recovery. An unpublished cooldown can also be lost if the process holding it crashes.

IBKR authentication and session state are still stored within each process. Sharing the limiter does not resolve session coordination across multiple backend instances.
