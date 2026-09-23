# Move IBKR rate limiting from local node process in-memory limiter to Redis 

This moves the IBKR rate limiter from process memory to Redis. Previously, each Node.js process kept its own request counters and cooldown, so multiple processes could exceed the shared allowance even when each stayed within its local limit. Restarting the backend also cleared its pacing state.

Redis now stores that state for all processes using the same allowance. The original implementation in services/ibkrPacing.service.js is kept for reference; brokerage requests use the new Redis limiter.

# *1. Redis setup*

Added services/redis.service.js to handle configuration, connections, connectivity checks, and cleanup. It uses one shared connection per process, and concurrent callers reuse the same connection attempt.

REDIS_URL sets the connection address. IBKR_RATE_LIMIT_SCOPE identifies the allowance being shared. Processes using the same allowance must use the same scope and Redis database. Both settings are validated before connecting.

Connection setup and commands have separate five-second deadlines. Offline command queues and automatic reconnection are disabled. After a failure, a later request can make a new connection attempt.

Also added:

scripts/checkRedis.js to check connectivity with PING without starting the application.
compose.redis.yml for local Redis setup, including a persistent volume, append-only persistence, a health check, and a port bound to localhost. It uses noeviction so Redis does not remove limiter keys to make room for other data.

# *2. Rate limiting*

Added services/ibkrRedisPacing.service.js with checkRequestLimit(path) and blockRequests(seconds).

The limits remain 10 brokerage requests per rolling second and 50 history requests per rolling minute. A history request counts toward both limits. Rejected requests do not use either allowance.

redis/checkRequestLimit.lua checks the limits and records an allowed request in one operation. This prevents separate backend processes from checking the same available slot and both taking it. Request records are stored in sorted sets, using Redis time and unique request IDs so simultaneous requests are counted separately. Old records are removed, and inactive keys expire.

When a limit is reached, the service returns 429 with a Retry-After value rounded up to whole seconds. redis/extendCooldown.lua handles shared cooldowns and only extends an existing block; a shorter cooldown cannot replace a longer one.

If Redis fails or times out, the service returns 503 and does not send the brokerage request. It does not fall back to local counters or automatically retry an uncertain Redis operation, since Redis may already have recorded it. Allowed attempts are also not refunded if the later IBKR request fails.

# *3. Brokerage integration*

The brokerage GET/POST wrapper in services/ibkrAuth.service.js now waits for Redis approval before calling fetch. This covers market data, accounts, brokerage status and initialization, and background /tickle calls. OAuth token and SSO-session creation remain outside this wrapper.

The ten-second IBKR timeout starts after Redis approves the request. If IBKR returns 429, the service stores a shared cooldown using its valid Retry-After value, or 900 seconds when no valid value is available.

If saving the cooldown fails, the request returns 503. The process remembers the remaining cooldown and must save it successfully before allowing another brokerage request. The upstream response body is still cleaned up when this happens.

Added src/server.js and updated src/index.js to check Redis before starting Express. The server will not start if Redis is unavailable or its configuration is missing.

On shutdown, the application stops accepting new HTTP requests and scheduling keep-alive calls, gives existing HTTP requests up to 30 seconds to finish, then closes Redis. Late work cannot reopen Redis or restart the keep-alive timer. The existing /health endpoint remains a liveness check.

# *4. Testing and recovery*

Testing covered requests from separate processes, shared cooldowns, Redis outages, and restarts. A timeout issue was fixed so Redis operations cannot leave requests waiting indefinitely. Added scripts/restoreRedisCooldown.js for manually restoring a cooldown after Redis data loss, with brokerage traffic stopped during recovery. Recorded results were 55 passing regular tests and a separate recovery run covering five passing scenarios. IBKR calls were mocked; live verification is still pending credentials.

# *5. Deployment notes*

Redis is now required to run the application. Stop processes still using the old local limiter when deploying this change.

Include the redis/ directory in the deployment, since the service loads the Lua files from there.

The current Git ignore rules exclude the AI test directories and my personal redis implementation notes. 

Redis data loss still needs manual recovery. An unpublished cooldown can also be lost if the process holding it crashes.

IBKR authentication and session state are still stored within each process. Sharing the limiter does not resolve session coordination across multiple backend instances.
