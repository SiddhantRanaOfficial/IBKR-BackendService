import { setTimeout as delay } from 'node:timers/promises';

import {
  getBrokerageRequest,
  getBrokerageSessionStatus
} from './ibkrAuth.service.js';

export async function getLiveSnapshot(conid, sessionToken) {
  // First, confirm brokerage access is ready.
  const status = await getBrokerageSessionStatus(sessionToken);

  const ready =
    status.authenticated &&
    status.connected &&
    status.established &&
    !status.competing;

  if (!ready) {
    const error = new Error(
      'Brokerage is not ready. Call POST /api/auth/connect first.'
    );

    error.statusCode = 503;
    throw error;
  }

  // IBKR requires this call before the snapshot endpoint.
  await getBrokerageRequest('/iserver/accounts', sessionToken);

  const query = new URLSearchParams({
    conids: conid,
    fields: '31,84,86,6509'
  });

  const path = `/iserver/marketdata/snapshot?${query}`;

  const priceOrNull = (value) =>
    value === undefined || value === null || value === ''
      ? null
      : value;

  // Allow for the initial response that may contain no prices.
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = await getBrokerageRequest(path, sessionToken);

    if (!Array.isArray(data)) {
      throw new Error('Unexpected IBKR snapshot response');
    }

    const snapshot = data.find(
      (item) => String(item.conid) === conid
    );

    if (snapshot) {
      const lastPrice = priceOrNull(snapshot['31']);
      const bid = priceOrNull(snapshot['84']);
      const ask = priceOrNull(snapshot['86']);

      // Return a partial quote when at least one price is available.
      if (lastPrice !== null || bid !== null || ask !== null) {
        return {
          conid: snapshot.conid,
          lastPrice,
          bid,
          ask,
          updatedAt: snapshot._updated ?? null,
          marketDataAvailability: snapshot['6509'] ?? null
        };
      }
    }

    if (attempt < 2) {
      await delay(1000);
    }
  }

  const error = new Error(
    'Quote prices are not available yet. Check data access or try again later.'
  );

  error.statusCode = 503;
  throw error;
}