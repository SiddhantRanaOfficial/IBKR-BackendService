// Reject invalid requests before auth.
import { parseConid } from '../validation/marketData.validation.js';

export function validateInstrumentDetails(req, res, next) {
  try {
    if (Object.keys(req.query).length) {
      const error = new Error('Instrument details does not accept query parameters');
      error.statusCode = 400;
      throw error;
    }
    try { res.locals.instrumentConid = parseConid(req.params.conid); }
    catch {
      const error = new Error('Provide one positive integer contract ID in the URL, for example /api/instruments/265598');
      error.statusCode = 400;
      throw error;
    }
    next();
  } catch (error) { next(error); }
}
