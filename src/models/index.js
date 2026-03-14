// src/models/index.js
import mongoose from 'mongoose';
const { Schema, model, Types } = mongoose;

// ─── USER MODEL ───────────────────────────────────────────────────────────────
const userSchema = new Schema({
  username: {
    type: String, required: true, unique: true, trim: true,
    minlength: 3, maxlength: 30,
    match: /^[a-zA-Z0-9_]+$/,
  },
  email: {
    type: String, required: true, unique: true, lowercase: true, trim: true,
  },
  password: { type: String, required: true, select: false },
  avatar: { type: String, default: null },
  status: {
    type: String,
    enum: ['online', 'offline', 'away', 'busy'],
    default: 'offline',
  },
  lastSeen: { type: Date, default: Date.now },
  refreshTokens: [{ type: String, select: false }],  // Support multiple devices

  // Notification preferences
  notificationPrefs: {
    email: { type: Boolean, default: true },
    push: { type: Boolean, default: true },
    digestIntervalMs: { type: Number, default: 30000 }, // per-user debounce window
    mutedRooms: [{ type: Types.ObjectId, ref: 'Room' }],
    quietHoursStart: { type: Number, default: null },  // 0-23
    quietHoursEnd: { type: Number, default: null },
  },

  // E2E encryption public key
  publicKey: { type: String, default: null },

  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

userSchema.index({ username: 'text', email: 'text' });
userSchema.index({ status: 1 });
userSchema.index({ lastSeen: -1 });

userSchema.virtual('displayName').get(function() {
  return this.username;
});

// ─── ROOM MODEL ──────────────────────────────────────────────────────────────
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

  // Cached stats (updated via change streams)
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

// ─── MESSAGE MODEL ────────────────────────────────────────────────────────────
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

messageSchema.virtual('reactionCount').get(function() {
  let count = 0;
  if (this.reactions) {
    for (const users of this.reactions.values()) {
      count += users.length;
    }
  }
  return count;
});

// ─── NOTIFICATION MODEL ───────────────────────────────────────────────────────
const notificationSchema = new Schema({
  recipient: { type: Types.ObjectId, ref: 'User', required: true, index: true },
  sender: { type: Types.ObjectId, ref: 'User', default: null },

  type: {
    type: String,
    enum: [
      'new_message', 'mention', 'reaction', 'room_invite',
      'user_joined', 'message_reply', 'system',
    ],
    required: true,
  },

  // Polymorphic reference
  entityType: { type: String, enum: ['Message', 'Room', 'User'], default: null },
  entityId: { type: Types.ObjectId, default: null },

  title: { type: String, required: true, maxlength: 200 },
  body: { type: String, required: true, maxlength: 500 },
  imageUrl: { type: String, default: null },

  isRead: { type: Boolean, default: false },
  readAt: { type: Date, default: null },

  // Delivery tracking
  channels: {
    inApp: { sent: Boolean, sentAt: Date },
    push: { sent: Boolean, sentAt: Date },
    email: { sent: Boolean, sentAt: Date },
  },

  // For digest batching — group related notifications
  batchKey: { type: String, default: null, index: true },
  isBatched: { type: Boolean, default: false },
  batchCount: { type: Number, default: 1 }, // How many events this represents
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // 30 day TTL

// ─── OFFLINE MESSAGE QUEUE MODEL ─────────────────────────────────────────────
const offlineQueueSchema = new Schema({
  recipient: { type: Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: Types.ObjectId, ref: 'Message', required: true },
  room: { type: Types.ObjectId, ref: 'Room', required: true },
  attempts: { type: Number, default: 0 },
  nextRetryAt: { type: Date, default: Date.now },
  isDelivered: { type: Boolean, default: false },
  deliveredAt: { type: Date, default: null },
}, {
  timestamps: true,
});

offlineQueueSchema.index({ recipient: 1, isDelivered: 1, nextRetryAt: 1 });
offlineQueueSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 }); // 7 day TTL

export const User = model('User', userSchema);
export const Room = model('Room', roomSchema);
export const Message = model('Message', messageSchema);
export const Notification = model('Notification', notificationSchema);
export const OfflineQueue = model('OfflineQueue', offlineQueueSchema);
