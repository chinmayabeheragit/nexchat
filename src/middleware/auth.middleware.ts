import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiResponse } from '../utils/apiResponse';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(ApiResponse.error('Authentication token required'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    // @ts-ignore
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json(ApiResponse.error('Invalid or expired token'));
  }
};

export const authenticateSocket = (socket: any, next: any) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication token required'));
  
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any;
    socket.userId = payload.userId;
    next();
  } catch (err) {
    next(new Error('Invalid or expired token'));
  }
};
