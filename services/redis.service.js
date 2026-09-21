// Independent Redis connection setup
import 'dotenv/config';
import { createClient } from 'redis';

let client;
let connecting;
const TIMEOUT_MS = 5000;

export function readRedisConfig(env = process.env) {
  let url;
  try {
    url = new URL(env.REDIS_URL);
  } catch {
    throw new Error('Set REDIS_URL to a valid redis:// or rediss:// URL.');
  }
  if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname) {
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
  if (client?.isReady) return client;
  if (connecting) return connecting;

  const { url } = readRedisConfig();
  const candidate = createClient({
    url,
    // Never retain commands to replay after a disconnected period. Stale commands can distort state in time sensitive use cases like rate limiting here
    disableOfflineQueue: true,
    commandsQueueMaxLength: 100,
    socket: { connectTimeout: TIMEOUT_MS, reconnectStrategy: false }
  });
  // Redis requires an error listener. This prevents printing of raw URLs and raw-credential bearing errors
  candidate.on('error', () => console.warn('[Redis] Connection error.', {
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
  })();
  return connecting;
}

export async function pingRedis() {
  const connection = await connectRedis();
  try {
    return await connection.withCommandOptions({
      abortSignal: AbortSignal.timeout(TIMEOUT_MS)
    }).ping();
  } catch (error) {
    throw unavailable(error);
  }
}

export async function closeRedis() {
  // Call this after stopping application work. No new commands should start during shutdown.
  const pending = connecting;
  if (client?.isOpen) client.destroy();
  client = undefined;
  if (pending) await pending.catch(() => { });
}
