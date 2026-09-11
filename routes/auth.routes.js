import { Router } from 'express';

import { ensureIBKRSession } from '../middleware/ibkrSession.middleware.js';
import { getIBKRStatus, connectIBKR } from '../controllers/auth.controller.js';

const router = Router();

// Just an endpoint to ensure that session token is available
router.post('/connect', ensureIBKRSession, connectIBKR);

router.get('/status', ensureIBKRSession, getIBKRStatus);

export default router;