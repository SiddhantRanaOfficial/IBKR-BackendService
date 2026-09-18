import { getLiveSnapshot } from '../services/marketData.service.js';

// Reuse authentication helpers without changing live retrieval.
import { createHistoricalMarketDataService } from '../services/historicalMarketData.service.js';
import {
  getBrokerageRequest,
  getBrokerageSessionStatus
} from '../services/ibkrAuth.service.js';

const getHistoricalBars = createHistoricalMarketDataService({
  getBrokerageRequest,
  getBrokerageSessionStatus
});

export async function getLiveMarketData(req, res, next) {
  try {
    const conid = req.query.conid;

    const sessionToken = res.locals.ibkrSessionToken;

    const quote = await getLiveSnapshot(conid, sessionToken);

    return res.json({
      success: true,
      source: 'ibkr',
      data: quote
    });
  } catch (error) {
    next(error);
  }
}

// Historical data retrieval controller
// GET /api/marketdata/history, after validation and authentication.
export async function getHistoricalMarketData(req, res, next) {
  try {
    const history = await getHistoricalBars(
      res.locals.historyQuery,
      res.locals.ibkrSessionToken
    );

    return res.json({
      success: true,
      source: 'ibkr',
      data: history
    });
  } catch (error) {
    next(error);
  }
}
