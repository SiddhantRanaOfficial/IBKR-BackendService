// Candidate matching, ranking and reuse.
import { normalizeInstrumentSearchResponse } from './instrument.service.js';
import { createInstrumentSearchCache, instrumentSearchCacheKey } from './instrumentSearchCache.service.js';
import { readRedisConfig } from './redis.service.js';

export function rankInstrumentMatches(rows, query) {
  const term = query.q.toUpperCase();
  const seen = new Set();
  const matches = [];
  for (const row of rows) {
    const text = (query.mode === 'symbol' ? row.symbol : row.name)?.toUpperCase();
    // Treat the user's input literally; do not run user-supplied regular expressions.
    const matchesQuery = text && (query.mode === 'symbol' ? text.startsWith(term) : text.includes(term));
    if (!matchesQuery || seen.has(row.conid)) continue;
    seen.add(row.conid);
    const rank = text === term ? 0 : text.startsWith(term) ? 1 : 2;
    matches.push({ row, text, rank });
  }
  // Stable ties retain IBKR's order. Different conids with the same symbol survive.
  matches.sort((a, b) => a.rank - b.rank || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  return matches.map(({ row }) => row);
}

export function createInstrumentAutocompleteService({
  getBrokerageRequest,
  cache = createInstrumentSearchCache(),
  getScope = () => readRedisConfig().scope
}) {
  // One promise per search in THIS backend process, not a distributed Redis lock.
  // All processes still share cached results and the existing Redis rate limiter.
  const inFlight = new Map();

  async function loadMatches(key, query, sessionToken) {
    const cached = await cache.get(key);
    if (cached !== null) return cached;

    const params = new URLSearchParams({ symbol: query.q });
    if (query.mode === 'name') params.set('name', 'true');
    else params.set('pattern', 'true');
    // IBKR exposes pattern search but does not document exhaustive prefix coverage.
    // Send plain text without invented wildcard syntax (live verification is pending).
    const response = await getBrokerageRequest(`/iserver/secdef/search?${params}`, sessionToken);
    const matches = rankInstrumentMatches(normalizeInstrumentSearchResponse(response), query).slice(0, 20);
    await cache.set(key, matches);
    return matches;
  }

  return async function searchInstruments(query, sessionToken) {
    const key = instrumentSearchCacheKey(query, sessionToken, getScope());
    let pending = inFlight.get(key);
    if (!pending) {
      if (inFlight.size >= 100) {
        const error = new Error('Too many instrument searches in progress. Try again shortly.');
        error.statusCode = 503;
        error.retryAfter = 1;
        throw error;
      }
      pending = loadMatches(key, query, sessionToken).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const matches = await pending;
    return {
      query: query.q,
      mode: query.mode,
      // Each caller gets its own array/objects and limit, even when sharing work.
      results: matches.slice(0, query.limit).map((row) => ({ ...row }))
    };
  };
}
