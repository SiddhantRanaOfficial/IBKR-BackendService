// Retrieve and normalize basic search results.
import { parseConid } from '../validation/marketData.validation.js';

// Like the history service, accept the request helper (getBrokerageRequest) so tests need no credentials.
export function createInstrumentService({ getBrokerageRequest }) {
  return async function searchInstruments(query, sessionToken) {
    const params = new URLSearchParams({ symbol: query.q });
    if (query.mode === 'name') params.set('name', 'true');

    // The shared helper supplies authentication, Redis pacing, timeout and errors.
    // Do not send deprecated secType or speculative prefix-search parameters.
    // No snapshot preflight, extra status request or automatic retry is needed here.
    const response = await getBrokerageRequest(
      `/iserver/secdef/search?${params}`,
      sessionToken
    );

    if (!Array.isArray(response)) throw malformedResponse();
    const results = response.map(normalizeInstrument);

    return {
      query: query.q,
      mode: query.mode,
      // This is our response limit, not an IBKR pagination/search parameter.
      // Preserve IBKR order and distinct listings
      results: results.slice(0, query.limit)
    };
  };
}

function malformedResponse() { // A custom error function for an invalid upstream response (Bad gateway)
  const error = new Error('Unexpected IBKR instrument search response');
  error.statusCode = 502;
  return error;
}

function textOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw malformedResponse();
  return value.trim() || null;
}

function normalizeInstrument(instrument) {
  if (
    instrument === null || typeof instrument !== 'object' ||
    Array.isArray(instrument) || Object.hasOwn(instrument, 'error')
  ) {
    throw malformedResponse();
  }

  let conid;
  try {
    // IBKR examples use both strings and numbers; expose one stable string ID.
    conid = parseConid(
      typeof instrument.conid === 'number' ? String(instrument.conid) : instrument.conid
    );
  } catch {
    // A bad upstream ID is an upstream failure, not invalid client input.
    throw malformedResponse();
  }

  return {
    conid,
    symbol: textOrNull(instrument.symbol),
    name: textOrNull(instrument.companyName),
    // description is the documented listing exchange. Derivative sections can
    // describe other contracts, so do not use their exchanges for this conid.
    exchange: textOrNull(instrument.description)
  };
}
