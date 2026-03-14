// src/sockets/socketHandler.js
import { authenticateSocket } from '../middleware/auth.js';
import { Message, Room, User } from '../models/index.js';
import { TypingDebouncer } from '../services/debounce/DebounceEngine.js';
import { debounceEngine } from '../services/debounce/DebounceEngine.js';
import logger from '../utils/logger.js';

/**
 * Register all Socket.io event handlers.
 * Architecture:
 *   - Auth via middleware on handshake
 *   - Each user joins their personal room (userId) for DMs/notifications
 *   - Join chat rooms as needed
 *   - Presence broadcasts on connect/disconnect
 */
export function registerSocketHandlers(io, notificationService) {
  // Auth middleware on every connection
  io.use(authenticateSocket);

  const typingDebouncer = new TypingDebouncer(io, parseInt(process.env.TYPING_DEBOUNCE_MS) || 1500);

  io.on('connection', async (socket) => {
    const { userId, username } = socket;
    logger.info(`[Socket] Connected: userId=${userId} socketId=${socket.id}`);

    // ── Personal room (for DM notifications) ──────────────────────────
    socket.join(`user:${userId}`);

    // ── Notify notification service ───────────────────────────────────
    await notificationService.onUserOnline(userId, socket.id);

    // ── Update user status ────────────────────────────────────────────
    await updateUserStatus(userId, 'online');
    io.emit('user:status', { userId, status: 'online', timestamp: Date.now() });

    // ── Auto-rejoin user's rooms ──────────────────────────────────────
    const rooms = await Room.find({ 'members.user': userId }).select('_id').lean();
    for (const room of rooms) {
      socket.join(room._id.toString());
    }

    // ═══════════════════════════════════════════════════════════════════
    //  EVENT: JOIN ROOM
    // ═══════════════════════════════════════════════════════════════════
    socket.on('room:join', async ({ roomId }, ack) => {
      try {
        const room = await Room.findOne({
          _id: roomId,
          'members.user': userId,
        });

        if (!room) {
          return ack?.({ error: 'Room not found or access denied' });
        }

        socket.join(roomId);
        socket.to(roomId).emit('room:user_joined', { userId, username, roomId });
        ack?.({ success: true, roomId });
        logger.debug(`[Socket] userId=${userId} joined room=${roomId}`);
      } catch (err) {
        logger.error(`[Socket] room:join error: ${err.message}`);
        ack?.({ error: 'Failed to join room' });
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    //  EVENT: SEND MESSAGE
    // ═══════════════════════════════════════════════════════════════════
    socket.on('message:send', async ({ roomId, content, type = 'text', replyTo = null, isEncrypted = false }, ack) => {
      try {
        if (!content || content.trim().length === 0) {
          return ack?.({ error: 'Message content required' });
        }

        const room = await Room.findOne({ _id: roomId, 'members.user': userId });
        if (!room) return ack?.({ error: 'Access denied' });

        // Create and save message
        const message = await Message.create({
          room: roomId,
          sender: userId,
          content: content.trim(),
          type,
          replyTo,
          isEncrypted,
        });

        await message.populate('sender', 'username avatar');

        // Update room's lastMessage cache
        await Room.updateOne({ _id: roomId }, {
          $set: {
            'lastMessage.content': content.slice(0, 100),
            'lastMessage.sender': userId,
            'lastMessage.sentAt': new Date(),
            'lastMessage.type': type,
          },
          $inc: { messageCount: 1 },
        });

        // Broadcast to room
        io.to(roomId).emit('message:new', {
          messageId: message._id,
          roomId,
          sender: { userId, username, avatar: message.sender.avatar },
          content: message.content,
          type,
          replyTo,
          isEncrypted,
          createdAt: message.createdAt,
        });

        // Cancel typing indicator
        typingDebouncer.userStoppedTyping(userId, roomId);

        // Notify other members
        const otherMembers = room.members.filter(m => m.user.toString() !== userId);
        for (const member of otherMembers) {
          const recipientId = member.user.toString();

          // Debounced read status update (don't write on every message)
          debounceEngine.debounce(
            `read_update:${recipientId}:${roomId}`,
            () => updateLastRead(recipientId, roomId),
            2000
          );

          // Notify if not muted
          if (!member.isMuted) {
            await notificationService.notify({
              recipientId: member.user,
              senderId: userId,
              type: 'new_message',
              entityType: 'Room',
              entityId: roomId,
              title: `New message in ${room.name || username}`,
              body: content.slice(0, 100),
            });
          }
        }

        ack?.({ success: true, messageId: message._id });
      } catch (err) {
        logger.error(`[Socket] message:send error: ${err.message}`);
        ack?.({ error: 'Failed to send message' });
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    //  EVENT: TYPING INDICATOR (debounced)
    // ═══════════════════════════════════════════════════════════════════
    socket.on('typing:start', ({ roomId }) => {
      typingDebouncer.userIsTyping(userId, roomId);
    });

    socket.on('typing:stop', ({ roomId }) => {
      typingDebouncer.userStoppedTyping(userId, roomId);
    });

    socket.on('typing:who', ({ roomId }, ack) => {
      ack?.({ typers: typingDebouncer.getActiveTypers(roomId) });
    });

    // ═══════════════════════════════════════════════════════════════════
    //  EVENT: REACTIONS
    // ═══════════════════════════════════════════════════════════════════
    socket.on('message:react', async ({ messageId, emoji }, ack) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) return ack?.({ error: 'Message not found' });

        const reactions = message.reactions || new Map();
        const existingUsers = reactions.get(emoji) || [];
        const alreadyReacted = existingUsers.some(id => id.toString() === userId);

        let update;
        if (alreadyReacted) {
          // Toggle off
          update = { $pull: { [`reactions.${emoji}`]: userId } };
        } else {
          update = { $addToSet: { [`reactions.${emoji}`]: userId } };
        }

        await Message.updateOne({ _id: messageId }, update);

        io.to(message.room.toString()).emit('message:reaction', {
          messageId,
          emoji,
          userId,
          action: alreadyReacted ? 'removed' : 'added',
        });

        ack?.({ success: true });
      } catch (err) {
        logger.error(`[Socket] message:react error: ${err.message}`);
        ack?.({ error: 'Failed to react' });
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    //  EVENT: READ RECEIPT
    // ═══════════════════════════════════════════════════════════════════
    socket.on('message:read', ({ roomId, messageId }) => {
      // Debounce read receipt writes — batch acknowledgement
      debounceEngine.debounce(
        `read:${userId}:${roomId}`,
        async () => {
          await Message.updateOne(
            { _id: messageId, 'readBy.user': { $ne: userId } },
            { $addToSet: { readBy: { user: userId, readAt: new Date() } } }
          );
          await updateLastRead(userId, roomId);
          // Notify sender their message was read
          socket.to(`room:${roomId}`).emit('message:read_receipt', {
            messageId, userId, roomId, readAt: new Date(),
          });
        },
        1000, // 1s debounce on read receipts
        { args: [] }
      );
    });

    // ═══════════════════════════════════════════════════════════════════
    //  EVENT: MESSAGE EDIT
    // ═══════════════════════════════════════════════════════════════════
    socket.on('message:edit', async ({ messageId, content }, ack) => {
      try {
        const message = await Message.findOne({ _id: messageId, sender: userId });
        if (!message) return ack?.({ error: 'Message not found or not yours' });

        // Save edit history
        await Message.updateOne({ _id: messageId }, {
          $set: { content: content.trim(), isEdited: true },
          $push: { editHistory: { content: message.content, editedAt: new Date() } },
        });

        io.to(message.room.toString()).emit('message:edited', {
          messageId, roomId: message.room, content: content.trim(), editedAt: new Date(),
        });

        ack?.({ success: true });
      } catch (err) {
        ack?.({ error: 'Failed to edit message' });
      }
    });

    // ═══════════════════════════════════════════════════════════════════
    //  EVENT: PRESENCE — USER AWAY/BUSY
    // ═══════════════════════════════════════════════════════════════════
    socket.on('user:status', async ({ status }) => {
      const allowed = ['online', 'away', 'busy'];
      if (!allowed.includes(status)) return;
      await updateUserStatus(userId, status);
      io.emit('user:status', { userId, status, timestamp: Date.now() });
    });

    // ═══════════════════════════════════════════════════════════════════
    //  DISCONNECT
    // ═══════════════════════════════════════════════════════════════════
    socket.on('disconnect', async (reason) => {
      logger.info(`[Socket] Disconnected: userId=${userId} reason=${reason}`);

      notificationService.onUserOffline(userId, socket.id);
      typingDebouncer.userStoppedTyping(userId, '*'); // Clear all typing

      // Check if user has other sockets still open
      const remainingSockets = await io.in(`user:${userId}`).fetchSockets();
      if (remainingSockets.length === 0) {
        await updateUserStatus(userId, 'offline');
        io.emit('user:status', { userId, status: 'offline', timestamp: Date.now() });
      }
    });
  });

  logger.info('✅ Socket.io handlers registered');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function updateUserStatus(userId, status) {
  await User.updateOne({ _id: userId }, {
    $set: { status, lastSeen: new Date() },
  });
}

async function updateLastRead(userId, roomId) {
  await Room.updateOne(
    { _id: roomId, 'members.user': userId },
    { $set: { 'members.$.lastRead': new Date() } }
  );
}
