import { getLiveSnapshot } from '../services/marketData.service.js';

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