import mongoose from 'mongoose';
const { Schema, model, Types } = mongoose;

const refreshTokenSchema = new Schema({
  user: { type: Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  replacedByToken: { type: String, default: null },
  createdByIp: { type: String },
}, {
  timestamps: true,
});

refreshTokenSchema.virtual('isExpired').get(function () {
  return Date.now() >= this.expiresAt.getTime();
});

refreshTokenSchema.virtual('isActive').get(function () {
  // @ts-ignore
  return !this.revokedAt && !this.isExpired;
});

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
export default RefreshToken;
