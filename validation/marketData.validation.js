const CONID_MESSAGE = 'Provide one valid conid, for example ?conid=265598';

const BARS_BY_PERIOD = {
  '1d': ['1min', '2min', '3min', '5min', '10min', '15min', '30min', '1h', '2h', '3h', '4h', '8h'],
  '1w': ['10min', '15min', '30min', '1h', '2h', '3h', '4h', '8h', '1d', '1w'],
  '1m': ['1h', '2h', '3h', '4h', '8h', '1d', '1w', '1m'],
  '1y': ['8h', '1d', '1w', '1m']
};

const ALLOWED_PARAMETERS = new Set(['conid', 'period', 'bar', 'outsideRth']);

function invalidQuery(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

export function parseConid(conid) {
  if (
    typeof conid !== 'string' ||
    !/^[1-9]\d*$/.test(conid) ||
    !Number.isSafeInteger(Number(conid))
  ) {
    throw invalidQuery(CONID_MESSAGE);
  }

  // Keep a string for the existing snapshot lookup and URLSearchParams.
  return conid;
}

export function parseHistoryQuery(query) {
  if (query === null || typeof query !== 'object' || Array.isArray(query)) {
    throw invalidQuery('Provide historical market data query parameters');
  }

  for (const key of Object.keys(query)) {
    if (!ALLOWED_PARAMETERS.has(key)) {
      throw invalidQuery('Allowed query parameters: conid, period, bar, outsideRth');
    }
  }

  const conid = parseConid(query.conid);
  const { period, bar, outsideRth } = query;

  if (typeof period !== 'string' || !Object.hasOwn(BARS_BY_PERIOD, period)) {
    throw invalidQuery('Provide a supported period: 1d, 1w, 1m, 1y');
  }

  if (typeof bar !== 'string' || !BARS_BY_PERIOD[period].includes(bar)) {
    throw invalidQuery(
      `Unsupported bar for period=${period}. Choose: ${BARS_BY_PERIOD[period].join(', ')}`
    );
  }

  if (outsideRth !== undefined && outsideRth !== 'true' && outsideRth !== 'false') {
    throw invalidQuery('outsideRth must be true or false');
  }

  return { conid, period, bar, outsideRth: outsideRth === 'true' };
}
