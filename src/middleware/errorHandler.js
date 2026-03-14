// src/middleware/errorHandler.js
import logger from '../utils/logger.js';

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Distinguish from programmer errors
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(errors) {
    super('Validation failed', 422, 'VALIDATION_ERROR', errors);
    this.name = 'ValidationError';
  }
}

// ─── Global Error Handler ─────────────────────────────────────────────────────
export function globalErrorHandler(err, req, res, _next) {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'unknown';

  // Default to 500 if not set
  err.statusCode = err.statusCode || 500;
  err.code = err.code || 'INTERNAL_ERROR';

  // Log based on severity
  if (err.statusCode >= 500) {
    logger.error({
      message: err.message,
      code: err.code,
      correlationId,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
  } else {
    logger.warn({
      message: err.message,
      code: err.code,
      correlationId,
      statusCode: err.statusCode,
      path: req.path,
    });
  }

  // Don't leak internals in production
  const isDev = process.env.NODE_ENV === 'development';

  // Handle specific error types
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_ID',
      message: `Invalid value for field: ${err.path}`,
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_ENTRY',
      message: `${field} already exists`,
    });
  }

  if (err.name === 'ValidationError' && err.errors) {
    // Mongoose validation error
    const errors = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(422).json({ success: false, code: 'VALIDATION_ERROR', errors });
  }

  return res.status(err.statusCode).json({
    success: false,
    code: err.code,
    message: err.isOperational ? err.message : 'An unexpected error occurred',
    details: err.details || undefined,
    ...(isDev && { stack: err.stack }),
    correlationId,
  });
}

// 404 handler for unmatched routes
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
  });
}
