import express from 'express';
import cors from 'cors';
import authRoutes from '../routes/auth.routes.js';
import { errorHandler } from '../middleware/error.middleware.js';

const app = express();

app.use(cors());
app.use(express.json());


// Just an endpoint to see if the server is running
app.get('/health', (req, res) => {
  return res.json({
    status: 'OK',
    message: 'IBKR Backend Service is running'
  });
});

app.use('/api/auth', authRoutes);

app.use(errorHandler);

export default app;