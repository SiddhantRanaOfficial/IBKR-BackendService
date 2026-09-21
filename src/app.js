import express from 'express';
import cors from 'cors';
import authRoutes from '../routes/auth.routes.js';
import { errorHandler } from '../middleware/error.middleware.js';
import marketDataRoutes from '../routes/marketData.routes.js';

const app = express();

// enables browser clients have access to the Retry-After response header.
app.use(cors({ exposedHeaders: ['Retry-After'] }));

app.use(express.json());


// Just an endpoint to see if the server is running
app.get('/health', (req, res) => {
  return res.json({
    status: 'OK',
    message: 'IBKR Backend Service is running bluck'
  });
});

app.use('/api/auth', authRoutes);

app.use('/api/marketdata', marketDataRoutes);

app.use(errorHandler);

export default app;
