// src/config/database.js
import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const MONGO_OPTIONS = {
  maxPoolSize: 10,           // Max 10 concurrent connections
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4,
  autoIndex: true,
};

let isConnected = false;
let retryCount = 0;
const MAX_RETRIES = 5;

export async function connectDB() {
  if (isConnected) return;

  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/chat_engine';

  mongoose.connection.on('connected', () => {
    isConnected = true;
    retryCount = 0;
    logger.info('✅ MongoDB connected successfully');
  });

  mongoose.connection.on('error', (err) => {
    logger.error(`❌ MongoDB connection error: ${err.message}`);
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('⚠️ MongoDB disconnected — attempting reconnect...');
    scheduleReconnect();
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed due to app termination');
    process.exit(0);
  });

  try {
    await mongoose.connect(uri, MONGO_OPTIONS);
  } catch (err) {
    logger.error(`Initial MongoDB connection failed: ${err.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (retryCount >= MAX_RETRIES) {
    logger.error('Max MongoDB reconnection attempts reached. Exiting.');
    process.exit(1);
  }

  const delay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Exponential backoff
  retryCount++;
  logger.info(`Reconnecting to MongoDB in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})`);

  setTimeout(() => connectDB(), delay);
}

export function getConnectionStatus() {
  return {
    isConnected,
    readyState: mongoose.connection.readyState,
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    states: { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' },
    host: mongoose.connection.host,
    name: mongoose.connection.name,
  };
}

export default connectDB;
