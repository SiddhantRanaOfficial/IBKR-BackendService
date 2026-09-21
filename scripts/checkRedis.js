// Just to check connectivity without starting Express or contacting IBKR.
import { pingRedis, closeRedis } from '../services/redis.service.js';

try {
  const response = await pingRedis();
  if (response !== 'PONG') throw new Error('Unexpected Redis ping response.');
  console.log('Redis connectivity verified: PONG');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeRedis();
}
