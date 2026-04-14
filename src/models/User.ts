import mongoose from 'mongoose';
const { Schema, model, Types } = mongoose;

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

export const User = model('User', userSchema);
export default User;
