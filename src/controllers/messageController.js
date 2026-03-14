// src/controllers/messageController.js
import { Message, Room, Notification } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

// ─── GET MESSAGES (cursor-based pagination) ────────────────────────────────────
export async function getMessages(req, res, next) {
  try {
    const { roomId } = req.params;
    const { before, limit = 50 } = req.query;
    const userId = req.user.userId;

    // Verify membership
    const room = await Room.findOne({ _id: roomId, 'members.user': userId });
    if (!room) throw new AppError('Room not found or access denied', 404);

    const query = { room: roomId, isDeleted: false };
    if (before) {
      query._id = { $lt: before };  // Cursor-based: messages before this ID
    }

    const messages = await Message.find(query)
      .sort({ _id: -1 })
      .limit(Math.min(parseInt(limit), 100))
      .populate('sender', 'username avatar status')
      .populate('replyTo', 'content sender')
      .lean();

    // Update lastRead
    const member = room.members.find(m => m.user.toString() === userId);
    if (member) {
      await Room.updateOne(
        { _id: roomId, 'members.user': userId },
        { $set: { 'members.$.lastRead': new Date() } }
      );
    }

    res.json({
      success: true,
      messages: messages.reverse(),
      hasMore: messages.length === parseInt(limit),
      nextCursor: messages.length > 0 ? messages[0]._id : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── SEARCH MESSAGES (Full-text) ────────────────────────────────────────────
export async function searchMessages(req, res, next) {
  try {
    const { roomId } = req.params;
    const { q, limit = 20 } = req.query;
    const userId = req.user.userId;

    if (!q || q.trim().length < 2) {
      throw new AppError('Search query must be at least 2 characters', 400);
    }

    const room = await Room.findOne({ _id: roomId, 'members.user': userId });
    if (!room) throw new AppError('Access denied', 403);

    const messages = await Message.find({
      room: roomId,
      isDeleted: false,
      $text: { $search: q.trim() },
    }, {
      score: { $meta: 'textScore' },
    })
      .sort({ score: { $meta: 'textScore' } })
      .limit(Math.min(parseInt(limit), 50))
      .populate('sender', 'username avatar')
      .lean();

    res.json({ success: true, results: messages, query: q, count: messages.length });
  } catch (err) {
    next(err);
  }
}

// ─── GET UNREAD COUNTS ─────────────────────────────────────────────────────
export async function getUnreadCounts(req, res, next) {
  try {
    const userId = req.user.userId;

    const rooms = await Room.find({ 'members.user': userId })
      .select('members lastMessage name type')
      .lean();

    const unreadCounts = await Promise.all(
      rooms.map(async (room) => {
        const member = room.members.find(m => m.user.toString() === userId);
        if (!member) return { roomId: room._id, unread: 0 };

        const count = await Message.countDocuments({
          room: room._id,
          createdAt: { $gt: member.lastRead },
          sender: { $ne: userId },
          isDeleted: false,
        });

        return {
          roomId: room._id,
          roomName: room.name,
          roomType: room.type,
          unread: count,
          lastMessage: room.lastMessage,
        };
      })
    );

    const totalUnread = unreadCounts.reduce((sum, r) => sum + r.unread, 0);

    res.json({ success: true, rooms: unreadCounts, totalUnread });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE MESSAGE (soft delete) ─────────────────────────────────────────
export async function deleteMessage(req, res, next) {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const message = await Message.findOne({ _id: messageId, sender: userId, isDeleted: false });
    if (!message) throw new AppError('Message not found', 404);

    await Message.updateOne(
      { _id: messageId },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: userId,
          content: '[Message deleted]',
        },
      }
    );

    logger.info(`[Message] Deleted messageId=${messageId} by userId=${userId}`);
    res.json({ success: true, message: 'Message deleted' });
  } catch (err) {
    next(err);
  }
}

// ─── AGGREGATION: Room analytics ─────────────────────────────────────────
export async function getRoomAnalytics(req, res, next) {
  try {
    const { roomId } = req.params;
    const { days = 7 } = req.query;
    const userId = req.user.userId;

    const room = await Room.findOne({ _id: roomId, 'members.user': userId });
    if (!room) throw new AppError('Access denied', 403);

    const since = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);

    const [messagesByDay, topSenders, hourlyActivity] = await Promise.all([
      // Messages per day
      Message.aggregate([
        { $match: { room: room._id, createdAt: { $gte: since }, isDeleted: false } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Top message senders
      Message.aggregate([
        { $match: { room: room._id, createdAt: { $gte: since }, isDeleted: false } },
        { $group: { _id: '$sender', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { userId: '$_id', username: '$user.username', count: 1 } },
      ]),

      // Activity by hour
      Message.aggregate([
        { $match: { room: room._id, createdAt: { $gte: since }, isDeleted: false } },
        { $group: { _id: { $hour: '$createdAt' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      success: true,
      analytics: {
        roomId,
        periodDays: parseInt(days),
        messagesByDay,
        topSenders,
        hourlyActivity,
        totalMessages: messagesByDay.reduce((s, d) => s + d.count, 0),
      },
    });
  } catch (err) {
    next(err);
  }
}
