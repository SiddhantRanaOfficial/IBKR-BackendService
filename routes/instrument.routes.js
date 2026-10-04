//GET /api/instruments/search.
import { Router } from 'express';
import { ensureIBKRSession } from '../middleware/ibkrSession.middleware.js';
import { validateInstrumentSearchQuery } from '../middleware/instrumentValidation.middleware.js';
import { searchInstrumentsController } from '../controllers/instrument.controller.js';

const router = Router();

// Validation runs first so bad searches use no authentication or IBKR allowance.
router.get('/search', validateInstrumentSearchQuery, ensureIBKRSession, searchInstrumentsController);

export default router;
