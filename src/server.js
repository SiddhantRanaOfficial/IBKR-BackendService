// Redis readiness and HTTP/keep-alive shutdown live here.
import app from './app.js';
import { pingRedis, closeRedis, shutdownRedis } from '../services/redis.service.js';
import { stopIBKRKeepAlive } from '../services/ibkrAuth.service.js';

export async function startServer(port = process.env.PORT || 3000) {
  // Refuse startup when the shared limiter cannot be reached.
  try {
    if (await pingRedis() !== 'PONG') throw new Error('Redis readiness check failed.');
  } catch (error) {
    await closeRedis();
    throw error;
  }

  const server = app.listen(port);
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  } catch (error) {
    await closeRedis();
    throw error;
  }
  console.log(`Server running at http://localhost:${server.address().port}`);

  let stopping;
  function shutdown() {
    if (stopping) return stopping;
    stopIBKRKeepAlive();
    stopping = (async () => {
      // Allow existing requests to finish, but never wait forever to shut down.
      const forceClose = setTimeout(() => server.closeAllConnections(), 30000);
      try {
        await new Promise(resolve => server.close(resolve));
      } finally {
        clearTimeout(forceClose);
        await shutdownRedis();
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      }
    })();
    return stopping;
  }
  function onSignal() {
    shutdown().catch(() => { process.exitCode = 1; });
  }
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return { server, shutdown };
}
