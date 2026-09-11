import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Create a signed JWT proving our application's identity.
function createClientAssertion() {
  const now = Math.floor(Date.now() / 1000);

  // Convert literal \n sequences into actual PEM newlines.
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

// Exchange the signed assertion for an OAuth access token.
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

// Health check.
app.get('/health', (req, res) => {
  return res.json({
    status: 'OK',
    message: 'IBKR Backend Service is running'
  });
});

// Test access-token acquisition.
app.post('/api/auth/connect', async (req, res) => {
  try {
    const accessToken = await getIBKRAccessToken();

    // We will use accessToken for session authentication in the next step.
    // For now, confirm success without returning or logging the token.
    return res.json({
      success: true,
      message: 'IBKR OAuth access token obtained successfully'
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});