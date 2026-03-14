// src/routes/index.js
import { Router } from 'express';
import { authenticate, refreshAccessToken } from '../middleware/auth.js';
import { authLimiter, messageLimiter, searchLimiter } from '../middleware/rateLimiter.js';
import { body, param, query, validationResult } from 'express-validator';

// Controllers
import * as authCtrl from '../controllers/authController.js';
import * as roomCtrl from '../controllers/roomController.js';
import * as msgCtrl from '../controllers/messageController.js';

const router = Router();

// ─── Validation helper ────────────────────────────────────────────────────────
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, code: 'VALIDATION_ERROR', errors: errors.array() });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════
const auth = Router();

auth.post('/register', authLimiter, [
  body('username').trim().isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be 8+ chars'),
], validate, authCtrl.register);

auth.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], validate, authCtrl.login);

auth.post('/logout', authenticate, authCtrl.logout);
auth.post('/refresh', refreshAccessToken);
auth.get('/me', authenticate, authCtrl.getMe);
auth.patch('/me/notifications', authenticate, authCtrl.updateNotificationPrefs);

// ═══════════════════════════════════════════════════════════════════
//  ROOM ROUTES
// ═══════════════════════════════════════════════════════════════════
const rooms = Router();
rooms.use(authenticate);

rooms.post('/', [
  body('type').isIn(['direct', 'group', 'channel']),
  body('name').if(body('type').not().equals('direct')).notEmpty().trim().isLength({ max: 100 }),
  body('members').isArray(),
], validate, roomCtrl.createRoom);

rooms.get('/', roomCtrl.getRooms);
rooms.get('/:roomId', roomCtrl.getRoom);
rooms.post('/:roomId/members', roomCtrl.addMembers);
rooms.delete('/:roomId/leave', roomCtrl.leaveRoom);
rooms.patch('/:roomId/mute', roomCtrl.muteRoom);
rooms.post('/:roomId/pin/:messageId', roomCtrl.pinMessage);

// ═══════════════════════════════════════════════════════════════════
//  MESSAGE ROUTES
// ═══════════════════════════════════════════════════════════════════
const messages = Router({ mergeParams: true });
messages.use(authenticate);

messages.get('/', [
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('before').optional().isMongoId(),
], validate, msgCtrl.getMessages);

messages.get('/search', searchLimiter, [
  query('q').trim().isLength({ min: 2 }),
], validate, msgCtrl.searchMessages);

messages.get('/unread', msgCtrl.getUnreadCounts);
messages.get('/analytics', msgCtrl.getRoomAnalytics);

messages.delete('/:messageId', [
  param('messageId').isMongoId(),
], validate, msgCtrl.deleteMessage);

// ═══════════════════════════════════════════════════════════════════
//  NOTIFICATION ROUTES
// ═══════════════════════════════════════════════════════════════════
const notifications = Router();
notifications.use(authenticate);

notifications.get('/', async (req, res, next) => {
  try {
    const { Notification } = await import('../models/index.js');
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const filter = { recipient: req.user.userId };
    if (unreadOnly === 'true') filter.isRead = false;

    const [items, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .populate('sender', 'username avatar'),
      Notification.countDocuments(filter),
    ]);

    res.json({
      success: true,
      notifications: items,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

notifications.patch('/read-all', async (req, res, next) => {
  try {
    const { Notification } = await import('../models/index.js');
    await Notification.updateMany(
      { recipient: req.user.userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

notifications.patch('/:id/read', async (req, res, next) => {
  try {
    const { Notification } = await import('../models/index.js');
    await Notification.updateOne(
      { _id: req.params.id, recipient: req.user.userId },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════
router.get('/health', async (req, res) => {
  const { getConnectionStatus } = await import('../config/database.js');
  const db = getConnectionStatus();
  res.json({
    status: db.isConnected ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      database: db.isConnected ? 'connected' : 'disconnected',
      node: process.version,
    },
  });
});

// Mount routers
router.use('/auth', auth);
router.use('/rooms', rooms);
router.use('/rooms/:roomId/messages', messages);
router.use('/notifications', notifications);

export default router;