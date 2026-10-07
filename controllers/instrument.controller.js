// Using the existing API response envelope for giving different endpoints a consistent response format.
// Kept earlier wiring (pre-autocomplete search feature) for reference.
// import { createInstrumentService } from '../services/instrument.service.js';
import { createInstrumentAutocompleteService } from '../services/instrumentAutocomplete.service.js';
import { getBrokerageRequest } from '../services/ibkrAuth.service.js';

// Ranking/Caching now precede the caller's limit unlike pre-autocompletion feature
// const searchInstruments = createInstrumentService({ getBrokerageRequest });
const searchInstruments = createInstrumentAutocompleteService({ getBrokerageRequest });

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
