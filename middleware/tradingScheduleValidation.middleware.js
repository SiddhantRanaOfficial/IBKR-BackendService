// Keep parsed input separate from Express input.
import { parseTradingScheduleQuery } from '../validation/tradingSchedule.validation.js';

export function validateTradingSchedule(req, res, next) {
  try {
    res.locals.tradingScheduleQuery = parseTradingScheduleQuery(req.params.conid, req.query);
    next();
  } catch (error) { next(error); }
}
