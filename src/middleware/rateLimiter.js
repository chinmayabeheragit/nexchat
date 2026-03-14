// src/middleware/rateLimiter.js
import rateLimit from 'express-rate-limit';
import { AppError } from './errorHandler.js';
import logger from '../utils/logger.js';

function createLimiter({ windowMs, max, message, keyPrefix = '' }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,   // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Key by user ID if authenticated, else by IP
      const id = req.user?.userId || req.ip;
      return `${keyPrefix}:${id}`;
    },
    handler: (req, res, next, options) => {
      logger.warn(`[RateLimit] Limit hit: ${req.method} ${req.path} by ${req.user?.userId || req.ip}`);
      next(new AppError(message, 429, 'RATE_LIMITED'));
    },
    skip: (req) => process.env.NODE_ENV === 'test',
  });
}

// General API — 100 req / 15 min
export const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests. Please try again later.',
  keyPrefix: 'api',
});

// Auth routes — 10 attempts / 15 min (brute-force protection)
export const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many auth attempts. Please try again in 15 minutes.',
  keyPrefix: 'auth',
});

// Message sending — 60 msg / min
export const messageLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Sending messages too fast. Slow down.',
  keyPrefix: 'msg',
});

// Search — 30 searches / min
export const searchLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Search rate limit exceeded.',
  keyPrefix: 'search',
});
