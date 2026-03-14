// src/controllers/roomController.js
import { Room, User, Message } from '../models/index.js';
import { AppError } from '../middleware/errorHandler.js';

export async function createRoom(req, res, next) {
  try {
    const { name, type = 'group', members = [], description, isPrivate = true } = req.body;
    const userId = req.user.userId;

    if (type === 'direct') {
      if (members.length !== 1) throw new AppError('Direct message requires exactly 1 other member', 400);

      // Check if DM already exists
      const existing = await Room.findOne({
        type: 'direct',
        'members.user': { $all: [userId, members[0]] },
        $expr: { $eq: [{ $size: '$members' }, 2] },
      });

      if (existing) {
        return res.json({ success: true, room: existing, isExisting: true });
      }
    }

    // Build member list with creator as owner
    const memberList = [
      { user: userId, role: 'owner', joinedAt: new Date() },
      ...members.map(id => ({ user: id, role: 'member', joinedAt: new Date() })),
    ];

    const room = await Room.create({
      name: type === 'direct' ? null : name,
      type,
      description,
      members: memberList,
      createdBy: userId,
      isPrivate,
    });

    await room.populate('members.user', 'username avatar status');

    res.status(201).json({ success: true, room });
  } catch (err) {
    next(err);
  }
}

export async function getRooms(req, res, next) {
  try {
    const userId = req.user.userId;

    const rooms = await Room.find({
      'members.user': userId,
      isArchived: false,
    })
      .populate('members.user', 'username avatar status')
      .sort({ 'lastMessage.sentAt': -1 })
      .lean();

    // Inject unread flag using lastRead
    const enriched = rooms.map(room => {
      const member = room.members.find(m => m.user._id.toString() === userId);
      return {
        ...room,
        myRole: member?.role,
        isMuted: member?.isMuted,
        hasUnread: room.lastMessage?.sentAt > (member?.lastRead || 0),
      };
    });

    res.json({ success: true, rooms: enriched, count: enriched.length });
  } catch (err) {
    next(err);
  }
}

export async function getRoom(req, res, next) {
  try {
    const { roomId } = req.params;
    const userId = req.user.userId;

    const room = await Room.findOne({ _id: roomId, 'members.user': userId })
      .populate('members.user', 'username avatar status lastSeen')
      .populate('pinnedMessages', 'content sender createdAt');

    if (!room) throw new AppError('Room not found', 404);
    res.json({ success: true, room });
  } catch (err) {
    next(err);
  }
}

export async function addMembers(req, res, next) {
  try {
    const { roomId } = req.params;
    const { userIds } = req.body;
    const userId = req.user.userId;

    const room = await Room.findOne({ _id: roomId, 'members.user': userId });
    if (!room) throw new AppError('Room not found', 404);

    const myMember = room.members.find(m => m.user.toString() === userId);
    if (!['owner', 'admin'].includes(myMember?.role)) {
      throw new AppError('Only admins can add members', 403);
    }

    const newMembers = userIds
      .filter(id => !room.members.some(m => m.user.toString() === id))
      .map(id => ({ user: id, role: 'member' }));

    if (newMembers.length === 0) {
      return res.json({ success: true, message: 'All users already in room' });
    }

    await Room.updateOne({ _id: roomId }, { $push: { members: { $each: newMembers } } });

    // System message
    await Message.create({
      room: roomId,
      sender: userId,
      content: `${newMembers.length} new member(s) added`,
      type: 'system',
      systemEventType: 'user_added',
    });

    res.json({ success: true, added: newMembers.length });
  } catch (err) {
    next(err);
  }
}

export async function leaveRoom(req, res, next) {
  try {
    const { roomId } = req.params;
    const userId = req.user.userId;

    const room = await Room.findOne({ _id: roomId, 'members.user': userId });
    if (!room) throw new AppError('Room not found', 404);

    const myMember = room.members.find(m => m.user.toString() === userId);

    // If owner, transfer to another admin or first member
    if (myMember?.role === 'owner' && room.members.length > 1) {
      const nextAdmin = room.members.find(
        m => m.user.toString() !== userId && m.role === 'admin'
      ) || room.members.find(m => m.user.toString() !== userId);

      if (nextAdmin) {
        await Room.updateOne(
          { _id: roomId, 'members.user': nextAdmin.user },
          { $set: { 'members.$.role': 'owner' } }
        );
      }
    }

    await Room.updateOne({ _id: roomId }, { $pull: { members: { user: userId } } });

    res.json({ success: true, message: 'Left room successfully' });
  } catch (err) {
    next(err);
  }
}

export async function muteRoom(req, res, next) {
  try {
    const { roomId } = req.params;
    const { mute = true } = req.body;
    const userId = req.user.userId;

    await Room.updateOne(
      { _id: roomId, 'members.user': userId },
      { $set: { 'members.$.isMuted': mute } }
    );

    res.json({ success: true, muted: mute });
  } catch (err) {
    next(err);
  }
}

export async function pinMessage(req, res, next) {
  try {
    const { roomId, messageId } = req.params;
    const userId = req.user.userId;

    const room = await Room.findOne({ _id: roomId, 'members.user': userId });
    if (!room) throw new AppError('Room not found', 404);

    const isPinned = room.pinnedMessages.map(String).includes(messageId);

    await Room.updateOne(
      { _id: roomId },
      isPinned
        ? { $pull: { pinnedMessages: messageId } }
        : { $addToSet: { pinnedMessages: messageId } }
    );

    res.json({ success: true, action: isPinned ? 'unpinned' : 'pinned' });
  } catch (err) {
    next(err);
  }
}
