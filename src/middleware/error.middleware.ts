import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../utils/apiResponse';
import logger from '../utils/logger';

export class AppError extends Error {
  public statusCode: number;
  public errorCode: string;

  constructor(message: string, statusCode: number = 500, errorCode: string = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  res.status(404).json(ApiResponse.error(`Route ${req.originalUrl} not found`));
};

export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(err.message, { stack: err.stack });

  if (err instanceof AppError) {
    return res.status(err.statusCode).json(ApiResponse.error(err.message));
  }

  res.status(500).json(ApiResponse.error('Internal Server Error'));
};
