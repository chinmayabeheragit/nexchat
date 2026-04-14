import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { globalLimiter } from './rateLimiter';
import authRoutes from '../services/auth/auth.routes';
import userRoutes from '../services/user/user.routes';
import chatRoutes from '../services/chat/chat.routes';
import notificationRoutes from '../services/notification/notification.routes';
import { globalErrorHandler, notFoundHandler } from '../middleware/error.middleware';
import { env } from '../config/env';

const app = express();

app.use(helmet());
app.use(cors({
  origin: env.CLIENT_ORIGINS || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use('/api', globalLimiter);

// Mount domains
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(notFoundHandler);
app.use(globalErrorHandler);

export default app;
