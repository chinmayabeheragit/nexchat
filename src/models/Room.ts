import mongoose from 'mongoose';
const { Schema, model, Types } = mongoose;

const roomSchema = new Schema({
  name: { type: String, trim: true, maxlength: 100, default: null }, // null for DMs
  type: {
    type: String,
    enum: ['direct', 'group', 'channel'],
    required: true,
    default: 'direct',
  },
  description: { type: String, maxlength: 500, default: null },
  avatar: { type: String, default: null },

  members: [{
    user: { type: Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
    lastRead: { type: Date, default: Date.now }, // For unread count
    isMuted: { type: Boolean, default: false },
  }],

  createdBy: { type: Types.ObjectId, ref: 'User', required: true },
  isPrivate: { type: Boolean, default: true },
  isArchived: { type: Boolean, default: false },

  // Cached stats (updated via change streams or manually)
  lastMessage: {
    content: String,
    sender: { type: Types.ObjectId, ref: 'User' },
    sentAt: Date,
    type: { type: String, enum: ['text', 'image', 'file', 'system'] },
  },
  messageCount: { type: Number, default: 0 },
  pinnedMessages: [{ type: Types.ObjectId, ref: 'Message' }],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

roomSchema.index({ 'members.user': 1 });
roomSchema.index({ type: 1, isPrivate: 1 });
roomSchema.index({ createdAt: -1 });
roomSchema.index({ name: 'text', description: 'text' });

roomSchema.virtual('memberCount').get(function() {
  return this.members.length;
});

export const Room = model('Room', roomSchema);
export default Room;
