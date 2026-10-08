// Reuse the existing response envelope for consistent JSON respones to the frontend
import { getBrokerageRequest } from '../services/ibkrAuth.service.js';
import { createInstrumentDetailsService } from '../services/instrumentDetails.service.js';

const getInstrumentDetails = createInstrumentDetailsService({ getBrokerageRequest });

export async function getInstrumentDetailsController(req, res, next) {
  try {
    const data = await getInstrumentDetails(res.locals.instrumentConid, res.locals.ibkrSessionToken);
    return res.json({ success: true, source: 'ibkr', data });
  } catch (error) {
    // Preserve authentication, pacing, timeout, and Retry-After handling.
    next(error);
  }
}
