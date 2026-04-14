import mongoose from 'mongoose';
import logger from '../utils/logger';
import { env } from './env';
import type { DBConnectionStatus } from '../types';

// ─── Connection options ────────────────────────────────────────────────────────
const MONGO_OPTIONS: mongoose.ConnectOptions = {
  maxPoolSize: 10,              // Max 10 concurrent connections
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4,                    // Force IPv4
  autoIndex: true,
};

// ─── State ────────────────────────────────────────────────────────────────────
let isConnected = false;
let retryCount = 0;
const MAX_RETRIES = 5;

// ─── Reconnect scheduler ──────────────────────────────────────────────────────
function scheduleReconnect(): void {
  if (retryCount >= MAX_RETRIES) {
    logger.error('Max MongoDB reconnection attempts reached. Exiting.');
    process.exit(1);
  }

  // Exponential backoff: 1s → 2s → 4s → ... capped at 30s
  const delay = Math.min(1000 * Math.pow(2, retryCount), 30_000);
  retryCount++;

  logger.info(`Reconnecting to MongoDB in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})`);
  setTimeout(() => connectDB(), delay);
}

// ─── Main connect function ────────────────────────────────────────────────────
export async function connectDB(): Promise<void> {
  if (isConnected) return;

  const uri = env.MONGO_URI;

  // ── Event listeners ──
  mongoose.connection.on('connected', () => {
    isConnected = true;
    retryCount = 0;
    logger.info('✅ MongoDB connected successfully');
  });

  mongoose.connection.on('error', (err: Error) => {
    logger.error(`❌ MongoDB connection error: ${err.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('⚠️  MongoDB disconnected — attempting reconnect...');
    scheduleReconnect();
  });

  // Graceful shutdown on SIGINT
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed due to app termination');
    process.exit(0);
  });

  // ── Attempt connection ──
  try {
    await mongoose.connect(uri, MONGO_OPTIONS);
  } catch (err) {
    logger.error(`Initial MongoDB connection failed: ${(err as Error).message}`);
    scheduleReconnect();
  }
}

// ─── Status helper ────────────────────────────────────────────────────────────
export function getConnectionStatus(): DBConnectionStatus {
  return {
    isConnected,
    readyState: mongoose.connection.readyState,
    states: {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    },
    host: mongoose.connection.host ?? 'unknown',
    name: mongoose.connection.name ?? 'unknown',
  };
}

export default connectDB;