// REDIS PHASE 2 SIMPLIFIED: Stage 4 remains in ibkrPacing.service.js, unchanged.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { connectRedis, readRedisConfig } from './redis.service.js';

// Read once when this module loads, not on every request.
const checkRequestLimitScript = readFileSync(
  new URL('../redis/checkRequestLimit.lua', import.meta.url), 'utf8'
);
const extendCooldownScript = readFileSync(
  new URL('../redis/extendCooldown.lua', import.meta.url), 'utf8'
);

function getRedisKeys() {
  const { scope } = readRedisConfig();
  // Processes using the same scope share an allowance. Braces keep related
  // keys together if Redis Cluster support is added later.
  const prefix = `ibkr:pacing:{${scope}}`;
  return {
    globalRequestsKey: `${prefix}:global`,
    historyRequestsKey: `${prefix}:history`,
    cooldownKey: `${prefix}:cooldown`
  };
}

async function runRedisScript(script, keys, scriptArguments) {
  try {
    const client = await connectRedis();
    const result = await client.withCommandOptions({
      abortSignal: AbortSignal.timeout(5000)
    }).eval(script, { keys, arguments: scriptArguments });
    if (!Number.isSafeInteger(result) || result < 0) {
      throw new Error('Invalid limiter response');
    }
    return result;
  } catch (err) {
    // Never bypass Redis or retry an uncertain result: a timed-out script
    // might already have recorded the request. Hide raw Redis errors.
    const error = new Error('Shared IBKR rate limiter is unavailable. Try again later.', { cause: err });
    error.statusCode = 503;
    throw error;
  }
}

export async function checkRequestLimit(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError('An IBKR endpoint path is required.');
  }
  const endpoint = path.split('?')[0];
  const isHistoryRequest = endpoint === '/iserver/marketdata/history';
  const { globalRequestsKey, historyRequestsKey, cooldownKey } = getRedisKeys();

  // Check BOTH limits and record admission atomically. Unique IDs count
  // simultaneous requests separately even when their timestamps match.
  const retryAfterMilliseconds = await runRedisScript(
    checkRequestLimitScript,
    [globalRequestsKey, historyRequestsKey, cooldownKey],
    [isHistoryRequest ? '1' : '0', randomUUID()]
  );
  if (retryAfterMilliseconds > 0) {
    const error = new Error('IBKR request limit reached. Please retry later.');
    error.statusCode = 429;
    error.retryAfter = Math.max(1, Math.ceil(retryAfterMilliseconds / 1000));
    throw error;
  }
}

export async function blockRequests(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 ||
    !Number.isSafeInteger(seconds * 1000)) {
    throw new TypeError('Cooldown must be positive integer seconds within a safe millisecond range.');
  }
  const { cooldownKey } = getRedisKeys();
  await runRedisScript(extendCooldownScript, [cooldownKey], [String(seconds * 1000)]);
}
