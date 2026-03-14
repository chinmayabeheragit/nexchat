// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import logger from '../utils/logger.js';
import { AppError } from './errorHandler.js';

/**
 * Verify JWT from Authorization header or cookie.
 * Attaches decoded user to req.user.
 */
export async function authenticate(req, res, next) {
  try {
    // Support Bearer token or cookie
    let token =
      req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : req.cookies?.accessToken;

    if (!token) {
      throw new AppError('No authentication token provided', 401, 'UNAUTHORIZED');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId).select('+refreshTokens');
    if (!user || !user.isActive) {
      throw new AppError('User not found or deactivated', 401, 'UNAUTHORIZED');
    }

    req.user = {
      userId: user._id.toString(),
      username: user.username,
      email: user.email,
    };

    req.correlationId = req.headers['x-correlation-id'] || decoded.userId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Token expired', 401, 'TOKEN_EXPIRED'));
    }
    if (err.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid token', 401, 'INVALID_TOKEN'));
    }
    next(err);
  }
}

/**
 * Verify Socket.io connection — called during socket handshake.
 */
export async function authenticateSocket(socket, next) {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('UNAUTHORIZED: No token'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('username status');

    if (!user || !user.isActive) {
      return next(new Error('UNAUTHORIZED: User inactive'));
    }

    socket.userId = user._id.toString();
    socket.username = user.username;
    next();
  } catch (err) {
    logger.error(`[Socket auth] ${err.message}`);
    next(new Error(`UNAUTHORIZED: ${err.message}`));
  }
}

/**
 * Generate access + refresh token pair.
 */
export function generateTokens(userId) {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '15m' }
  );

  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );

  return { accessToken, refreshToken };
}

/**
 * Verify refresh token and issue new pair.
 */
export async function refreshAccessToken(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError('Refresh token required', 400);

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.userId).select('+refreshTokens');

    if (!user || !user.refreshTokens.includes(refreshToken)) {
      throw new AppError('Invalid refresh token', 401, 'INVALID_TOKEN');
    }

    // Rotate refresh token (security best practice)
    const tokens = generateTokens(user._id.toString());
    user.refreshTokens = user.refreshTokens
      .filter(t => t !== refreshToken)
      .concat(tokens.refreshToken)
      .slice(-5); // Keep max 5 devices

    await user.save();

    res.json({ success: true, ...tokens });
  } catch (err) {
    next(err);
  }
}

/**
 * Require a specific role within a room.
 */
export function requireRoomRole(...allowedRoles) {
  return async (req, res, next) => {
    try {
      const { Room } = await import('../models/index.js');
      const roomId = req.params.roomId || req.body.roomId;
      const room = await Room.findById(roomId);

      if (!room) throw new AppError('Room not found', 404);

      const member = room.members.find(
        m => m.user.toString() === req.user.userId
      );

      if (!member) throw new AppError('Not a member of this room', 403, 'FORBIDDEN');
      if (!allowedRoles.includes(member.role)) {
        throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
      }

      req.roomMember = member;
      next();
    } catch (err) {
      next(err);
    }
  };
}
