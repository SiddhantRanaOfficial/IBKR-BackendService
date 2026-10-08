// Selected-contract metadata.
import { parseConid } from '../validation/marketData.validation.js';

function malformedResponse() {
  const error = new Error('Unexpected IBKR instrument details response');
  error.statusCode = 502;
  return error;
}

function textOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw malformedResponse();
  return value.trim() || null;
}

// Identifying text must agree when both names exist.
// In case response contains symbol: "AAPL" as well as ticker: "MSFT". This causes a conflict. This function protects against the conflict by throwing an error.
function matchingTextOrNull(primary, alternative) {
  const first = textOrNull(primary);
  const second = textOrNull(alternative);
  if (first !== null && second !== null && first !== second) {
    throw malformedResponse();
  }
  return first ?? second;
}

export function normalizeInstrumentDetails(response, requestedConid) {
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
    Object.hasOwn(response, 'error')) throw malformedResponse();

  // The documentation's example uses con_id; its field table uses conid. 
  //(The documentation has inconsistencies regarding the field names. The documented field names and example response field names are different so we write code to accomodate both the aliases)
  // Require an ID and check every supplied alias so we never label a wrong
  // contract's data with the ID the client requested.
  const ids = [response.con_id, response.conid].filter((id) => id !== undefined && id !== null);
  if (!ids.length) throw malformedResponse();
  for (const id of ids) {
    let conid;
    try { conid = parseConid(typeof id === 'number' ? String(id) : id); }
    catch { throw malformedResponse(); }
    if (conid !== requestedConid) throw malformedResponse();
  }

  // Normalize blanks before choosing an alias.
  // Earlier selection [ textOrNull(response.symbol ?? response.ticker) ] ignored populated alternatives when the first field was blank [ symbol: "" and ticker: "AAPL"]: We fix it here 
  // const exchanges = textOrNull(response.valid_exchanges ?? response.validExchanges);
  const exchanges = textOrNull(response.valid_exchanges) ?? textOrNull(response.validExchanges);
  return {
    conid: requestedConid,
    // Preserved old mappings for reference.
    // symbol: textOrNull(response.symbol ?? response.ticker),
    // name: textOrNull(response.company_name ?? response.companyName),
    // securityType: textOrNull(response.instrument_type ?? response.secType),
    symbol: matchingTextOrNull(response.symbol, response.ticker),
    name: textOrNull(response.company_name) ?? textOrNull(response.companyName),
    securityType: matchingTextOrNull(response.instrument_type, response.secType),
    currency: textOrNull(response.currency),
    // Do not infer a listing exchange from SMART or from validExchanges.
    listingExchange: textOrNull(response.listingExchange),
    exchange: textOrNull(response.exchange),
    validExchanges: exchanges
      ? [...new Set(exchanges.split(',').map((value) => value.trim()).filter(Boolean))]
      : []
  };
}

export function createInstrumentDetailsService({ getBrokerageRequest }) {
  return async function getInstrumentDetails(conid, sessionToken) {
    const response = await getBrokerageRequest(`/iserver/contract/${conid}/info`, sessionToken);
    return normalizeInstrumentDetails(response, conid);
  };
}
