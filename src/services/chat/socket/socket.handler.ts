import { Server } from 'socket.io';
import { authenticateSocket } from '../../../middleware/auth.middleware';
import { Message } from '../../../models/Message';
import { Room } from '../../../models/Room';
import { User } from '../../../models/User';
import logger from '../../../utils/logger';

export function registerSocketHandlers(io: Server) {
  io.use(authenticateSocket);

  io.on('connection', async (socket: any) => {
    const userId = socket.userId;
    logger.info(`[Socket] Connected: userId=${userId}`);

    socket.join(`user:${userId}`);
    await User.updateOne({ _id: userId }, { $set: { status: 'online', lastSeen: new Date() } });
    io.emit('user:status', { userId, status: 'online', timestamp: Date.now() });

    const rooms = await Room.find({ 'members.user': userId }).select('_id').lean();
    for (const room of rooms) {
      socket.join(room._id.toString());
    }

    socket.on('disconnect', async () => {
      logger.info(`[Socket] Disconnected: userId=${userId}`);
      const remainingSockets = await io.in(`user:${userId}`).fetchSockets();
      if (remainingSockets.length === 0) {
        await User.updateOne({ _id: userId }, { $set: { status: 'offline', lastSeen: new Date() } });
        io.emit('user:status', { userId, status: 'offline', timestamp: Date.now() });
      }
    });

    socket.on('room:join', async ({ roomId }: any, ack: Function) => {
      try {
        const room = await Room.findOne({ _id: roomId, 'members.user': userId });
        if (!room) return ack?.({ error: 'Access denied' });
        socket.join(roomId);
        ack?.({ success: true, roomId });
      } catch (err) {
        ack?.({ error: 'Failed to join room' });
      }
    });

    socket.on('message:send', async ({ roomId, content, type = 'text' }: any, ack: Function) => {
      try {
        const message = await Message.create({ room: roomId, sender: userId, content, type });
        await message.populate('sender', 'username avatar');
        
        io.to(roomId).emit('message:new', message);
        ack?.({ success: true, messageId: message._id });
        
      } catch (err) {
        ack?.({ error: 'Failed to send message' });
      }
    });
  });
}
