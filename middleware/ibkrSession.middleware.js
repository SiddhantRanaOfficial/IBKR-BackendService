import { getIBKRSessionToken } from '../services/ibkrAuth.service.js';

export async function ensureIBKRSession(req, res, next) {
  try {
    const sessionToken = await getIBKRSessionToken();

    res.locals.ibkrSessionToken = sessionToken;

    next();
  } catch (error) {
    next(error);
  }
}