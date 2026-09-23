// Independent Redis connection setup
import 'dotenv/config';
import { createClient } from 'redis';

let client;  // Shared redis client reference/object in one node.js process
let connecting; // Holds promise for an ongoing connection attempt. This avoids starting a separate connection attempt for every request.

// Final application shutdown must not reopen Redis for late work.
// The application begins shutting down.
// Some unfinished asynchronous work continues running.
// That work calls connectRedis().
// The shutdown flag prevents it from reopening Redis.
// "false" allows connectRedis() to connect. "True" ensures connectRedis() refuses new connection attempts.
let shuttingDown = false;
const TIMEOUT_MS = 5000;

export function readRedisConfig(env = process.env) {
  let url;
  try {
    url = new URL(env.REDIS_URL); // Parsing the url to check it's syntactic validity
  } catch (err) {
    throw new Error('Set REDIS_URL to a valid redis:// or rediss:// URL.', { cause: err });
  }
  if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname) { // Validating redis specific url validity. Reject the conf if the protocol is unsupported or the hostname is missing
    throw new Error('REDIS_URL must use redis:// or rediss:// and include a host.');
  }
  const scope = env.IBKR_RATE_LIMIT_SCOPE;
  if (typeof scope !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(scope)) {
    throw new Error('Set IBKR_RATE_LIMIT_SCOPE to 1-80 letters, digits, underscores or hyphens.');
  }
  return { url: url.href, scope };
}

function unavailable(cause) {
  const error = new Error('Redis is unavailable. Check Redis configuration and connectivity.', { cause });
  error.statusCode = 503;
  return error;
}

export async function connectRedis() {
  if (shuttingDown) throw unavailable();
  if (client?.isReady) return client;
  if (connecting) return connecting;

  const { url } = readRedisConfig();
  const candidate = createClient({
    url,
    disableOfflineQueue: true, // Never retain commands to replay after a disconnected period. Stale commands can distort state in time sensitive use cases like rate limiting here
    commandsQueueMaxLength: 100, // Counts commands waiting to be written and commands already written waiting for replies. Another command is rejected when that count reaches 100.
    socket: { connectTimeout: TIMEOUT_MS, reconnectStrategy: false }
  });
  // Redis requires an error listener. This prevents printing of raw URLs and raw-credential bearing errors
  candidate.on('error', (error) => console.warn('[Redis] Connection error.', {
    code: error.code,
    name: error.name
  }));
  client = candidate;
  connecting = (async () => {
    // Bound the entire handshake as well as the socket connection attempt. This prevents the connection function from hanging indefinitely. 
    const timer = setTimeout(() => {
      if (candidate.isOpen) candidate.destroy();
    }, TIMEOUT_MS);
    try {
      await candidate.connect();
      return candidate;
    } catch (error) {
      if (candidate.isOpen) candidate.destroy();
      if (client === candidate) client = undefined;
      throw unavailable(error);
    } finally {
      clearTimeout(timer);
      connecting = undefined;
    }
  })(); // Immediately invoked function expression (IIFE)
  return connecting;
}

export async function pingRedis() {
  const connection = await connectRedis();
  try {
    return await withRedisCommandTimeout(connection, () => connection.ping());
  } catch (error) {
    throw unavailable(error);
  }
}

// a queue AbortSignal alone does not bound a reply after a
// command is sent. Bound the full operation and discard the timed-out socket.
// Closing it does NOT undo a script that already executed; never auto-retry it.
export async function withRedisCommandTimeout(connection, operation) {
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(unavailable());
      if (connection.isOpen) connection.destroy();
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function closeRedis() {
  // Call this after stopping application work. No new commands should start during shutdown.
  const pending = connecting;
  if (client?.isOpen) client.destroy();
  client = undefined;
  if (pending) await pending.catch(() => { });
}

// unlike closeRedis (reusable), this ends this process's lifecycle.
export async function shutdownRedis() {
  shuttingDown = true;
  await closeRedis();
}
