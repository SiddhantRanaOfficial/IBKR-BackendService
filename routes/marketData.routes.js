import { Router } from 'express';

import { ensureIBKRSession } from '../middleware/ibkrSession.middleware.js';

import { getLiveMarketData } from '../controllers/marketData.controller.js';

const router = Router();

function validateConid(req, res, next) {
  const { conid } = req.query;

  if (
    typeof conid !== 'string' ||
    !/^[1-9]\d*$/.test(conid) ||
    !Number.isSafeInteger(Number(conid))
  ) {
    return res.status(400).json({
      success: false,
      message: 'Provide one valid conid, for example ?conid=265598'
    });
  }

  next();
}

router.get(
  '/live',
  validateConid,
  ensureIBKRSession,
  getLiveMarketData
);

export default router;