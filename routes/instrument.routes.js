//GET /api/instruments/search.
import { Router } from 'express';
import { ensureIBKRSession } from '../middleware/ibkrSession.middleware.js';
import { validateInstrumentSearchQuery } from '../middleware/instrumentValidation.middleware.js';
import { searchInstrumentsController } from '../controllers/instrument.controller.js';
import { validateInstrumentDetails } from '../middleware/instrumentDetailsValidation.middleware.js';
import { getInstrumentDetailsController } from '../controllers/instrumentDetails.controller.js';
import { validateTradingSchedule } from '../middleware/tradingScheduleValidation.middleware.js';
import { getTradingScheduleController } from '../controllers/tradingSchedule.controller.js';

const router = Router();

// Validation runs first so bad searches use no authentication or IBKR allowance.
router.get('/search', validateInstrumentSearchQuery, ensureIBKRSession, searchInstrumentsController);

// Invalid input must not start authentication.
router.get('/:conid/schedule', validateTradingSchedule, ensureIBKRSession, getTradingScheduleController);

// Keep /search first so Express does not interpret "search" as a contract ID.
// /api/instruments/265598 → req.params.conid = "265598"
// /api/instruments/search → req.params.conid = "search"
// Both could match /:conid.
// GET /api/instruments/search?q=AAPL
// Matches /:conid
// req.params.conid becomes "search"
// Details validation rejects the request     ↓
// Returns 400 instead of searching
// It would not automatically try the next route after validation fails.
router.get('/:conid', validateInstrumentDetails, ensureIBKRSession, getInstrumentDetailsController);

export default router;
