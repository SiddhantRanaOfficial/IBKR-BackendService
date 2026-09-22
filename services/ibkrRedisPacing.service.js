// Redis Rate Limiter; Local Rate Limiter remains preserved in ibkrPacingService.js
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { connectRedis, readRedisConfig, withRedisCommandTimeout } from './redis.service.js';

// retain an observed cooldown if publication fails. This is not
// a local request counter: admission still always requires Redis approval.
let pendingCooldownUntil = 0;

async function publishPendingCooldown() {
  const deadline = pendingCooldownUntil;
  const remainingMilliseconds = Math.ceil(deadline - performance.now());
  if (remainingMilliseconds > 0) {
    const { cooldownKey } = getRedisKeys();
    await runRedisScript(extendCooldownScript, [cooldownKey], [String(remainingMilliseconds)]);
  }
  // Do not erase a longer cooldown received while the Redis call was pending.
  if (pendingCooldownUntil === deadline) pendingCooldownUntil = 0;
}

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
    // REDIS PHASE 4: enforce the deadline even after Redis receives the script.
    const result = await withRedisCommandTimeout(client, () =>
      client.eval(script, { keys, arguments: scriptArguments })
    );
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
  // REDIS PHASE 3: recover unpublished cooldowns before any new admission.
  if (pendingCooldownUntil > 0) await publishPendingCooldown();
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
  // REDIS PHASE 3: remember first, then publish; errors leave the deadline intact.
  pendingCooldownUntil = Math.max(pendingCooldownUntil, performance.now() + seconds * 1000);
  await publishPendingCooldown();
}
