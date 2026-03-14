// src/server.js
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';

import connectDB from './config/database.js';
import routes from './routes/index.js';
import { registerSocketHandlers } from './sockets/socketHandler.js';
import { NotificationService } from './services/notification/NotificationService.js';
import { startChangeStreams, stopChangeStreams } from './workers/chnageStreamWatcher.js';
import { globalErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { debounceEngine } from './services/debounce/DebounceEngine.js';
import logger from './utils/logger.js';

const app = express();
const httpServer = createServer(app);

// ─── Socket.io setup ──────────────────────────────────────────────────────────
const io = new SocketServer(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGINS?.split(',') || ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB max message size
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,  // Recover state within 2 min
    skipMiddlewares: true,
  },
});

// ─── Express middleware ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Configure as needed
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.CLIENT_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP request logging (skip in test)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.path === '/api/health',
  }));
}

// Attach correlation ID to every request
app.use((req, _res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || `req_${Date.now()}`;
  next();
});

// Global rate limit
app.use('/api', apiLimiter);

// ─── API routes ────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── Error handling ────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Start notification service (needs io)
    const notificationService = new NotificationService(io);

    // 3. Register socket handlers
    registerSocketHandlers(io, notificationService);

    // 4. Start MongoDB Change Streams
    startChangeStreams(io, notificationService);

    // 5. Start HTTP server
    const PORT = process.env.PORT || 5000;
    httpServer.listen(PORT, () => {
      logger.info(`
╔══════════════════════════════════════════════════╗
║       Chat + Notification Engine v1.0.0          ║
║──────────────────────────────────────────────────║
║  HTTP  : http://localhost:${PORT}                    ║
║  WS    : ws://localhost:${PORT}                      ║
║  Env   : ${process.env.NODE_ENV || 'development'}                       ║
╚══════════════════════════════════════════════════╝
      `);
    });

    // 6. Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`\n${signal} received — shutting down gracefully...`);

      debounceEngine.destroy();
      await stopChangeStreams();
      httpServer.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
      logger.error(`Unhandled rejection: ${reason}`);
    });

    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
      process.exit(1);
    });

    return httpServer;
  } catch (err) {
    logger.error(`Bootstrap failed: ${err.message}`);
    process.exit(1);
  }
}

bootstrap();

export { app, io };
