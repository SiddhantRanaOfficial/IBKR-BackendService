// Reject invalid input before session work.
import { parseInstrumentSearchQuery } from '../validation/instrument.validation.js';

export function validateInstrumentSearchQuery(req, res, next) {
  try {
    res.locals.instrumentSearchQuery = parseInstrumentSearchQuery(req.query);
    next();
  } catch (error) {
    next(error);
  }
}
