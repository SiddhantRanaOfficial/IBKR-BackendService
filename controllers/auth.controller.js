import {
  initializeBrokerageSession,
  getBrokerageSessionStatus
} from '../services/ibkrAuth.service.js';

function isBrokerageReady(status) {
  return (
    status.authenticated &&
    status.connected &&
    status.established &&
    !status.competing
  );
}

// POST /api/auth/connect
export async function connectIBKR(req, res, next) {
  try {
    const sessionToken = res.locals.ibkrSessionToken;

    const status = await initializeBrokerageSession(sessionToken);

    const ready = isBrokerageReady(status);

    return res.json({
      success: true,
      ready,
      message: ready
        ? 'IBKR brokerage session is ready'
        : 'Initialization was requested, but brokerage is not ready',
      status
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/auth/status
export async function getIBKRStatus(req, res, next) {
  try {
    const sessionToken = res.locals.ibkrSessionToken;

    const status = await getBrokerageSessionStatus(sessionToken);

    return res.json({
      success: true,
      ready: isBrokerageReady(status),
      status
    });
  } catch (error) {
    next(error);
  }
}

//This function just returns a response that the session token
// is available and the authentication is completed