import { Router } from 'express';

import { ensureIBKRSession } from '../middleware/ibkrSession.middleware.js';

import { getLiveMarketData } from '../controllers/marketData.controller.js';
import { validateConid } from '../middleware/marketDataValidation.middleware.js';

const router = Router();

router.get(
  '/live',
  validateConid,
  ensureIBKRSession,
  getLiveMarketData
);

export default router;
