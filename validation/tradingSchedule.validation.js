// Validate before session or brokerage work.
import { parseConid } from './marketData.validation.js';

function invalidQuery(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

export function parseTradingScheduleQuery(conid, query) {
  let contractId;
  try { contractId = parseConid(conid); }
  catch { throw invalidQuery('Provide one positive integer contract ID in /api/instruments/:conid/schedule'); }
  // Express returns a query object (It might be an empty object in case of no query from the client). It returns an array in case of repeated property names.
  // This query object check is a defensive protocol for direct calls to this function
  // like this parseTradingScheduleQuery("265598", undefined);
  // parseTradingScheduleQuery("265598", "exchange=NASDAQ");
  // parseTradingScheduleQuery("265598", []);
  if (!query || typeof query !== 'object' || Array.isArray(query) ||
    Object.keys(query).some((key) => key !== 'exchange')) {
    throw invalidQuery('Trading schedule accepts only the optional exchange query parameter');
  }
  let exchange = null;
  if (query.exchange !== undefined) {
    // False, incase of no query string in the request. 
    if (typeof query.exchange !== 'string' || /[\u0000-\u001f\u007f]/.test(query.exchange)) {
      throw invalidQuery('exchange must be one exchange code without control characters');
    }
    exchange = query.exchange.trim();
    if (!exchange || exchange.length > 64) {
      throw invalidQuery('exchange must contain between 1 and 64 characters');
    }
  }
  return { conid: contractId, exchange };
}
