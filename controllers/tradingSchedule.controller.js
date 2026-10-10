// Reuse the shared authenticated request helper.
import { getBrokerageRequest } from '../services/ibkrAuth.service.js';
import { createTradingScheduleService } from '../services/tradingSchedule.service.js';

const getTradingSchedule = createTradingScheduleService({ getBrokerageRequest });

export async function getTradingScheduleController(req, res, next) {
  try {
    const data = await getTradingSchedule(res.locals.tradingScheduleQuery, res.locals.ibkrSessionToken);
    return res.json({ success: true, source: 'ibkr', data });
  } catch (error) { next(error); }
}
