import { Router } from 'express';

import { ensureIBKRSession } from '../middleware/ibkrSession.middleware.js';

import {
  getLiveMarketData,
  getHistoricalMarketData
} from '../controllers/marketData.controller.js';

import {
  validateConid,
  validateHistoryQuery
} from '../middleware/marketDataValidation.middleware.js';


const router = Router();

router.get(
  '/live',
  validateConid,
  ensureIBKRSession,
  getLiveMarketData
);

// Historical data
// Reject invalid input before obtaining an IBKR session.
router.get(
  '/history',
  validateHistoryQuery,
  ensureIBKRSession,
  getHistoricalMarketData
);


export default router;
