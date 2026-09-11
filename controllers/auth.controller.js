export function connectIBKR(req, res) {
  return res.json({
    success: true,
    message: 'IBKR session token is available'
  });
}

//This file just returns a response that the session token
// is available and the authentication is completed