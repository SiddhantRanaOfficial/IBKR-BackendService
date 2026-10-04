// INSTRUMENT SEARCH PHASE 1 — NEW FILE: use the existing API response envelope.
import { createInstrumentService } from '../services/instrument.service.js';
import { getBrokerageRequest } from '../services/ibkrAuth.service.js';

const searchInstruments = createInstrumentService({ getBrokerageRequest });

export async function searchInstrumentsController(req, res, next) {
  try {
    const data = await searchInstruments(
      res.locals.instrumentSearchQuery,
      res.locals.ibkrSessionToken
    );

    return res.json({ success: true, source: 'ibkr', data });
  } catch (error) {
    // Preserve shared errors, including 429/503 and their Retry-After guidance.
    next(error);
  }
}
