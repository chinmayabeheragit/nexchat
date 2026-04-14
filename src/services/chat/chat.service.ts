import { Room } from '../../models/Room';
import { Message } from '../../models/Message';

export class ChatService {
  static async createRoom(data: any, userId: string) {
    const { type, name, members } = data;
    
    const roomMembers = members.map((m: string) => ({ user: m }));
    if (!members.includes(userId)) {
      roomMembers.push({ user: userId, role: 'owner' });
    }

    const room = await Room.create({
      type,
      name,
      members: roomMembers,
      createdBy: userId,
    });
    return room;
  }

  static async getRooms(userId: string) {
    return Room.find({ 'members.user': userId });
  }

  static async getMessages(roomId: string, limit: number = 50) {
    return Message.find({ room: roomId }).sort({ createdAt: -1 }).limit(limit);
  }

  static async searchMessages(query: string, userId: string) {
    return Message.find({ content: { $regex: query, $options: 'i' } }).limit(20);
  }
}
