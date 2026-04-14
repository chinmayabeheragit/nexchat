import mongoose from 'mongoose';
const { Schema, model, Types } = mongoose;

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

export const Notification = model('Notification', notificationSchema);
export default Notification;
