import { parseConid, parseHistoryQuery } from '../validation/marketData.validation.js';

export function validateConid(req, res, next) {
  try {
    parseConid(req.query.conid);
  } catch (error) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  next();
}

// Register before ensureIBKRSession when the history route is added.
export function validateHistoryQuery(req, res, next) {
  try {
    res.locals.historyQuery = parseHistoryQuery(req.query);
  } catch (error) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  next();
}
