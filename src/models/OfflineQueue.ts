import mongoose from 'mongoose';
const { Schema, model, Types } = mongoose;

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

export const OfflineQueue = model('OfflineQueue', offlineQueueSchema);
export default OfflineQueue;
