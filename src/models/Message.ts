import mongoose from 'mongoose';
const { Schema, model, Types } = mongoose;

const messageSchema = new Schema({
  room: { type: Types.ObjectId, ref: 'Room', required: true, index: true },
  sender: { type: Types.ObjectId, ref: 'User', required: true },

  content: { type: String, required: true, maxlength: 10000 },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'system', 'reply'],
    default: 'text',
  },

  // Reply chain
  replyTo: { type: Types.ObjectId, ref: 'Message', default: null },

  // E2E encrypted content (alternative to `content`)
  encryptedContent: { type: String, default: null },
  isEncrypted: { type: Boolean, default: false },

  // Attachments (stored URLs, e.g. S3)
  attachments: [{
    url: String,
    type: { type: String, enum: ['image', 'video', 'audio', 'document'] },
    name: String,
    size: Number,
    mimeType: String,
  }],

  // Delivery & read tracking
  deliveredTo: [{ type: Types.ObjectId, ref: 'User' }],
  readBy: [{
    user: { type: Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now },
  }],

  // Reactions: { "👍": [userId, ...] }
  reactions: {
    type: Map,
    of: [{ type: Types.ObjectId, ref: 'User' }],
    default: {},
  },

  isEdited: { type: Boolean, default: false },
  editHistory: [{
    content: String,
    editedAt: { type: Date, default: Date.now },
  }],

  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Types.ObjectId, ref: 'User', default: null },

  // For system messages
  systemEventType: {
    type: String,
    enum: ['user_joined', 'user_left', 'room_created', 'user_added', 'user_removed'],
    default: null,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

messageSchema.index({ room: 1, createdAt: -1 });   // Main query pattern
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ room: 1, isDeleted: 1 });
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 }); // 1 year TTL

messageSchema.virtual('reactionCount').get(function () {
  let count = 0;
  if (this.reactions) {
    for (const users of this.reactions.values()) {
      count += users.length;
    }
  }
  return count;
});

export const Message = model('Message', messageSchema);
export default Message;
