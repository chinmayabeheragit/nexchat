// src/utils/logger.js
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { v4 as uuidv4 } from 'uuid';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// Custom log format for console
const consoleFormat = printf(({ level, message, timestamp, correlationId, stack, ...meta }) => {
  const cid = correlationId ? `[${correlationId}] ` : '';
  const metaStr = Object.keys(meta).length ? `\n  ${JSON.stringify(meta)}` : '';
  const stackStr = stack ? `\n${stack}` : '';
  return `${timestamp} ${level} ${cid}${message}${metaStr}${stackStr}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    json()
  ),
  defaultMeta: { service: 'chat-engine' },
  transports: [
    // Console transport (colorized for dev)
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'HH:mm:ss.SSS' }),
        consoleFormat
      ),
    }),

    // Daily rotating error log
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),

    // Daily rotating combined log
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '50m',
      maxFiles: '7d',
      zippedArchive: true,
    }),
  ],
  exitOnError: false,
});

// Attach a correlation ID to a child logger for request tracing
logger.withCorrelationId = (correlationId = uuidv4()) => {
  return logger.child({ correlationId });
};

export default logger;
