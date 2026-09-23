// operator recovery ONLY after suspected loss of limiter state.
// Stop brokerage traffic first. This publishes a block for the configured scope.
import { readRedisConfig, closeRedis } from '../services/redis.service.js';
import { blockRequests } from '../services/ibkrRedisPacing.service.js';

try {
  readRedisConfig();
  const seconds = Number(process.argv[2] ?? 900);
  if (!Number.isSafeInteger(seconds) || seconds < 900 ||
    !Number.isSafeInteger(seconds * 1000)) {
    throw new Error('Recovery cooldown must be integer seconds, at least 900.');
  }
  await blockRequests(seconds);
  console.log(`Shared recovery cooldown recorded for ${seconds} seconds.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeRedis();
}
