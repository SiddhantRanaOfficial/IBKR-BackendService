// Here, this function makes possible trade-bar retrieval using the existing brokerage helpers.

export function createHistoricalMarketDataService({
  getBrokerageRequest,
  getBrokerageSessionStatus
}) {
  return async function getHistoricalBars(query, sessionToken) {
    const status = await getBrokerageSessionStatus(sessionToken);
    if (
      !status.authenticated || !status.connected ||
      !status.established || status.competing
    ) {
      const error = new Error('Brokerage is not ready. Call POST /api/auth/connect first.');
      error.statusCode = 503;
      throw error;
    }

    // Query values have already been validated before session middleware runs using the validator middlware functions.
    const params = new URLSearchParams({
      conid: query.conid,
      period: query.period,
      bar: query.bar,
      outsideRth: String(query.outsideRth),
      source: 'Last'
    });

    // History endpoint needs one request, with no snapshot preflight or automatic retries unlike snapshot endpoint
    const response = await getBrokerageRequest(
      `/iserver/marketdata/history?${params}`,
      sessionToken
    );
    return normalizeHistory(response, query);
  };
}

function malformedResponse() {
  const error = new Error('Unexpected IBKR historical market data response');
  error.statusCode = 502;
  return error;
}

function normalizeHistory(response, query) {
  if (
    response === null || typeof response !== 'object' ||
    Array.isArray(response) || Object.hasOwn(response, 'error') ||
    !Array.isArray(response.data)
  ) {
    throw malformedResponse();
  }

  const bars = response.data.map((bar) => {
    if (
      bar === null || typeof bar !== 'object' || Array.isArray(bar) ||
      !['t', 'o', 'h', 'l', 'c'].every((key) => Number.isFinite(bar[key])) ||
      (bar.v != null && !Number.isFinite(bar.v))
    ) {
      throw malformedResponse();
    }

    // Keeping IBKR timestamp, prices, and volume unchanged 
    // Retain the factors below
    return {
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v ?? null
    };
  }).sort((left, right) => left.timestamp - right.timestamp);

  return {
    conid: Number(query.conid),
    symbol: response.symbol ?? null,
    name: response.text ?? null,
    period: query.period,
    bar: query.bar,
    barSource: 'Last',
    outsideRth: query.outsideRth,
    barCount: bars.length,
    // Historical availability codes and volume factors are not snapshot fields.
    metadata: {
      timePeriod: response.timePeriod ?? null,
      barLength: response.barLength ?? null,
      outsideRth: response.outsideRth ?? null,
      startTime: response.startTime ?? null,
      mdAvailability: response.mdAvailability ?? null,
      mktDataDelay: response.mktDataDelay ?? null,
      priceFactor: response.priceFactor ?? null,
      volumeFactor: response.volumeFactor ?? null,
      points: response.points ?? null
    },
    bars
  };
}
