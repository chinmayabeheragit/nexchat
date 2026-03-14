// src/controllers/authController.js
import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { generateTokens } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

export async function register(req, res, next) {
  try {
    const { username, email, password } = req.body;

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      throw new AppError(
        existingUser.email === email ? 'Email already registered' : 'Username taken',
        409, 'DUPLICATE_ENTRY'
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({ username, email, password: hashedPassword });

    const { accessToken, refreshToken } = generateTokens(user._id.toString());

    // Store refresh token
    user.refreshTokens = [refreshToken];
    await user.save();

    logger.info(`[Auth] New user registered: ${username}`);

    res.status(201).json({
      success: true,
      user: { id: user._id, username, email },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password +refreshTokens');
    if (!user) throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');

    if (!user.isActive) throw new AppError('Account deactivated', 403, 'ACCOUNT_DEACTIVATED');

    const { accessToken, refreshToken } = generateTokens(user._id.toString());

    user.refreshTokens = [...(user.refreshTokens || []), refreshToken].slice(-5);
    user.status = 'online';
    user.lastSeen = new Date();
    await user.save();

    logger.info(`[Auth] Login: ${user.username}`);

    res.json({
      success: true,
      user: { id: user._id, username: user.username, email: user.email, status: 'online' },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    const userId = req.user.userId;

    await User.updateOne(
      { _id: userId },
      {
        $pull: { refreshTokens: refreshToken },
        $set: { status: 'offline', lastSeen: new Date() },
      }
    );

    logger.info(`[Auth] Logout: userId=${userId}`);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.user.userId).select('-__v');
    if (!user) throw new AppError('User not found', 404);
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

export async function updateNotificationPrefs(req, res, next) {
  try {
    const { digestIntervalMs, quietHoursStart, quietHoursEnd, mutedRooms } = req.body;

    const update = {};
    if (digestIntervalMs != null) update['notificationPrefs.digestIntervalMs'] = Math.max(5000, digestIntervalMs);
    if (quietHoursStart != null) update['notificationPrefs.quietHoursStart'] = quietHoursStart;
    if (quietHoursEnd != null) update['notificationPrefs.quietHoursEnd'] = quietHoursEnd;
    if (mutedRooms) update['notificationPrefs.mutedRooms'] = mutedRooms;

    await User.updateOne({ _id: req.user.userId }, { $set: update });
    res.json({ success: true, message: 'Notification preferences updated' });
  } catch (err) {
    next(err);
  }
}
