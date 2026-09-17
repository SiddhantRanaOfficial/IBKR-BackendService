import 'dotenv/config';
import jwt from 'jsonwebtoken';

// Here the session token will be cached so other requests don't have to re-authenticate everytime

let cachedSessionToken = null;
let sessionTokenPromise = null;

let keepAliveTimer = null;
let tickleInProgress = false;

// Here I create the assertion for the OAuth access-token request.
function createClientAssertion() {
  const now = Math.floor(Date.now() / 1000);

  const privateKey = process.env.IBKR_PRIVATE_KEY.replace(/\\n/g, '\n');

  return jwt.sign(
    {
      iss: process.env.IBKR_CLIENT_ID,
      sub: process.env.IBKR_CLIENT_ID,
      aud: '/token',
      exp: now + 20,
      iat: now - 10
    },
    privateKey,
    {
      algorithm: 'RS256',
      keyid: process.env.IBKR_CLIENT_KEY_ID
    }
  );
}

// Obtain an OAuth access token from the exposed "/token" endpoint of the WebAPI
async function getIBKRAccessToken() {
  const requiredVariables = [
    'IBKR_CLIENT_ID',
    'IBKR_CLIENT_KEY_ID',
    'IBKR_PRIVATE_KEY',
    'IBKR_OAUTH_BASE_URL'
  ];

  for (const name of requiredVariables) {
    if (!process.env[name]) {
      throw new Error(`Missing environment variable: ${name}`);
    }
  }

  const baseUrl = process.env.IBKR_OAUTH_BASE_URL.replace(/\/$/, '');

  if (new URL(baseUrl).protocol !== 'https:') {
    throw new Error('IBKR_OAUTH_BASE_URL must use HTTPS');
  }

  const clientAssertion = createClientAssertion();

  const tokenBody = new URLSearchParams({
    client_assertion_type:
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
    grant_type: 'client_credentials',
    scope: process.env.IBKR_SCOPE || 'sso-sessions.write'
  });

  const response = await fetch(`${baseUrl}/api/v1/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: tokenBody,
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(
      `IBKR access-token request failed: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error('IBKR did not return an access token');
  }

  return data.access_token;
}

// Here i create the assertion for the SSO session request.
function createSessionAssertion() {
  const now = Math.floor(Date.now() / 1000);

  const privateKey = process.env.IBKR_PRIVATE_KEY.replace(/\\n/g, '\n');

  return jwt.sign(
    {
      ip: process.env.IBKR_CLIENT_IP,
      credential: process.env.IBKR_CREDENTIAL,
      iss: process.env.IBKR_CLIENT_ID,
      exp: now + 86400,
      iat: now
    },
    privateKey,
    {
      algorithm: 'RS256',
      keyid: process.env.IBKR_CLIENT_KEY_ID
    }
  );
}

// Here an OAuth access token is sent to obtain an SSO session token.
async function requestIBKRSessionToken() {
  const requiredVariables = [
    'IBKR_GATEWAY_BASE_URL',
    'IBKR_CLIENT_IP',
    'IBKR_CREDENTIAL'
  ];

  for (const name of requiredVariables) {
    if (!process.env[name]) {
      throw new Error(`Missing environment variable: ${name}`);
    }
  }

  const baseUrl = process.env.IBKR_GATEWAY_BASE_URL.replace(/\/$/, '');

  if (new URL(baseUrl).protocol !== 'https:') {
    throw new Error('IBKR_GATEWAY_BASE_URL must use HTTPS');
  }

  const accessToken = await getIBKRAccessToken();
  const sessionAssertion = createSessionAssertion();

  const response = await fetch(`${baseUrl}/api/v1/sso-sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/jwt'
    },
    body: sessionAssertion,
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(
      `IBKR session-token request failed: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error('IBKR did not return a session token');
  }

  return data.access_token;
}

/* If a session token already exists then no reauthentication will take place but 
 If the session token is not null (authentication is undergoing) then the other ongoing requests will wait 
 for the authentication to finish instead of sending another authentication request*/
export async function getIBKRSessionToken() {
  if (cachedSessionToken) {
    return cachedSessionToken;
  }

  if (!sessionTokenPromise) {
    sessionTokenPromise = requestIBKRSessionToken()
      .then((token) => {
        cachedSessionToken = token;
        startIBKRKeepAlive();
        return token;
      })
      .finally(() => {
        sessionTokenPromise = null;
      });
  }

  return sessionTokenPromise;
}

// Send an authenticated request using the SSO session token.
async function postBrokerageRequest(path, sessionToken, body) {
  const response = await fetch(
    `https://api.ibkr.com/v1/api${path}`,
    {
      method: 'POST',

      headers: {
        'User-Agent': `IBKR-BackendService/1.0 Node.js/${process.versions.node}`,
        Accept: '*/*',
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      },

      body: body === undefined
        ? undefined
        : JSON.stringify(body),

      signal: AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    if (
      response.status === 401 &&
      cachedSessionToken === sessionToken
    ) {
      cachedSessionToken = null;
    }

    throw new Error(
      `IBKR request to ${path} failed: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`IBKR returned an error for ${path}`);
  }

  return data;
}

// Read the current brokerage status.
export async function getBrokerageSessionStatus(sessionToken) {
  const data = await postBrokerageRequest(
    '/iserver/auth/status',
    sessionToken
  );

  // Support the direct response and the wrapped documentation example.
  const status = data.success?.value ?? data;

  return {
    authenticated: status.authenticated === true,
    connected: status.connected === true,
    established: status.established === true,
    competing: status.competing === true
  };
}

// Request initialization, then check whether brokerage access is ready.
export async function initializeBrokerageSession(sessionToken) {
  await postBrokerageRequest(
    '/iserver/auth/ssodh/init',
    sessionToken,
    {
      publish: true,
      compete: false
    }
  );

  return getBrokerageSessionStatus(sessionToken);
}

export async function getBrokerageRequest(path, sessionToken) {
  const response = await fetch(
    `https://api.ibkr.com/v1/api${path}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        Accept: 'application/json',
        'User-Agent': `IBKR-BackendService/1.0 Node.js/${process.versions.node}`
      },
      signal: AbortSignal.timeout(10000)
    }
  );

  if (!response.ok) {
    if (
      response.status === 401 &&
      cachedSessionToken === sessionToken
    ) {
      cachedSessionToken = null;
    }

    throw new Error(
      `IBKR request failed: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (data.error) {
    throw new Error('IBKR returned an error response');
  }

  return data;
}

function startIBKRKeepAlive() {
  // Repeated authentication requests must not create more timers.
  if (keepAliveTimer) {
    return;
  }

  keepAliveTimer = setInterval(async () => {
    // Only ping an existing session.
    // Do not create a new session from this background task.
    if (!cachedSessionToken || tickleInProgress) {
      return;
    }

    tickleInProgress = true;

    // Capture the token used for this particular request.
    const sessionToken = cachedSessionToken;

    try {
      const data = await postBrokerageRequest(
        '/tickle',
        sessionToken
      );

      // Ignore an old response if the cached token changed.
      if (cachedSessionToken !== sessionToken) {
        return;
      }

      const status = data.iserver?.authStatus;

      console.log('[IBKR keep-alive] Ping succeeded', {
        authenticated: status?.authenticated,
        connected: status?.connected,
        ssoExpires: data.ssoExpires
      });

      if (
        status?.authenticated === false ||
        status?.connected === false ||
        status?.competing === true
      ) {
        console.warn(
          '[IBKR keep-alive] Brokerage is not ready. ' +
          'Check GET /api/auth/status before requesting market data.'
        );
      }
    } catch (error) {
      console.error(
        '[IBKR keep-alive] Ping failed:',
        error.message
      );
    } finally {
      tickleInProgress = false;
    }
  }, 60_000);

  // The timer alone should not prevent Node.js from exiting.
  keepAliveTimer.unref();
}