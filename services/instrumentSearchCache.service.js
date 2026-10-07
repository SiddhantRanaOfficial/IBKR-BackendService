// Short-lived metadata, never pacing state.
import { createHash } from 'node:crypto';
import { connectRedis, withRedisCommandTimeout } from './redis.service.js';

const MAX_BYTES = 32_768;

export function instrumentSearchCacheKey(query, sessionToken, scope) {
  // Different sessions cannot share results. Hash the token; never store/log it.
  // Limit is excluded: every cached entry contains up to the maximum 20 matches.
  const digest = createHash('sha256')
    .update(JSON.stringify([sessionToken, query.mode, query.q.toUpperCase()]))
    .digest('hex');
  return `ibkr:instruments:{${scope}}:search:v2:${digest}`;
}

async function executeRedis(operation) {
  const connection = await connectRedis();
  return withRedisCommandTimeout(connection, () => operation(connection));
}

// Inject only the Redis operation for isolated tests; production uses real Redis.
export function createInstrumentSearchCache({ execute = executeRedis } = {}) {
  return {
    async get(key) {
      let value;
      try {
        value = await execute((client) => client.get(key));
      } catch {
        // Redis is already required by admission. Fail without sending IBKR work.
        const error = new Error('Instrument search cache is unavailable. Try again later.');
        error.statusCode = 503;
        error.retryAfter = 1;
        throw error;
      }

      if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_BYTES) return null;
      try {
        const rows = JSON.parse(value);
        // A corrupt/old cache value is a miss, not an empty successful search.
        if (!Array.isArray(rows) || rows.length > 20 || !rows.every(validRow)) return null;
        return rows.map(({ conid, symbol, name, exchange }) => ({ conid, symbol, name, exchange }));
      } catch {
        return null;
      }
    },

    async set(key, rows) {
      const value = JSON.stringify(rows);
      if (Buffer.byteLength(value) > MAX_BYTES) return;
      try {
        // EX expires the value in seconds. Empty searches expire sooner.
        await execute((client) => client.set(key, value, { EX: rows.length ? 300 : 30 }));
      } catch {
        // Admission already succeeded. A failed optional cache write must not
        // discard good data or trigger another IBKR request. Never log raw errors.
        console.warn('[Instrument search] Could not cache results.');
      }
    }
  };
}

function validRow(row) {
  return row !== null && typeof row === 'object' && !Array.isArray(row) &&
    typeof row.conid === 'string' && /^[1-9]\d*$/.test(row.conid) &&
    Number.isSafeInteger(Number(row.conid)) &&
    ['symbol', 'name', 'exchange'].every((field) => row[field] === null || typeof row[field] === 'string');
}
