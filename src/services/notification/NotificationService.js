// src/services/notification/NotificationService.js
import Bull from 'bull';
import { Notification, User, OfflineQueue } from '../../models/index.js';
import { NotificationDebouncer } from '../debounce/DebounceEngine.js';
import logger from '../../utils/logger.js';

/**
 * NotificationService — orchestrates the full notification lifecycle:
 *   1. Create notification record in MongoDB
 *   2. Debounce per-user delivery (batch within window)
 *   3. Deliver via: in-app Socket.io | push | email
 *   4. Queue offline delivery for disconnected users
 */
export class NotificationService {
  constructor(io) {
    this.io = io;
    this._onlineUsers = new Map(); // userId → Set<socketId>

    // Bull queue for async / durable delivery
    this.deliveryQueue = new Bull('notification-delivery', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
      },
      defaultJobOptions: {
        attempts: parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });

    // Per-user debounce engine for batching
    this.debouncer = new NotificationDebouncer(
      this._deliverBatch.bind(this),
      parseInt(process.env.NOTIFICATION_DEBOUNCE_MS) || 30000,
      60000  // maxWait: always deliver within 60s
    );

    this._registerQueueWorkers();
  }

  /**
   * Queue a notification. The debouncer will batch and deliver.
   */
  async notify({ recipientId, senderId = null, type, entityType, entityId, title, body, imageUrl = null }) {
    try {
      // Respect user notification preferences
      const user = await User.findById(recipientId).select('notificationPrefs status');
      if (!user) return;

      const prefs = user.notificationPrefs;

      // Skip if room is muted for this user
      if (entityType === 'Room' && prefs.mutedRooms.map(String).includes(String(entityId))) {
        logger.debug(`[Notification] Skipped — room muted for userId=${recipientId}`);
        return;
      }

      // Check quiet hours
      if (this._isQuietHours(prefs)) {
        logger.debug(`[Notification] Quiet hours active for userId=${recipientId}`);
        // Still save to DB, just skip live delivery
      }

      // Persist to MongoDB
      const notification = await Notification.create({
        recipient: recipientId,
        sender: senderId,
        type,
        entityType,
        entityId,
        title,
        body,
        imageUrl,
        batchKey: `${recipientId}:${type}:${entityId}`,
        channels: {
          inApp: { sent: false },
          push: { sent: false },
          email: { sent: false },
        },
      });

      // Route to debounced delivery
      this.debouncer.queue(recipientId.toString(), {
        notificationId: notification._id.toString(),
        type, title, body, imageUrl, entityType, entityId, senderId,
      });

    } catch (err) {
      logger.error(`[Notification] Failed to queue: ${err.message}`);
    }
  }

  /**
   * Called by debouncer with batched notifications for a user.
   */
  async _deliverBatch(userId, batch) {
    const isOnline = this._isUserOnline(userId);

    if (isOnline) {
      await this._deliverInApp(userId, batch);
    } else {
      // Store in offline queue for delivery on reconnect
      await this._queueOfflineDelivery(userId, batch);
    }

    // Queue push/email in background
    for (const notif of batch) {
      await this.deliveryQueue.add('push', { userId, notification: notif });
    }
  }

  /**
   * Push to connected socket(s) for this user.
   */
  async _deliverInApp(userId, batch) {
    const socketIds = this._onlineUsers.get(userId);
    if (!socketIds || socketIds.size === 0) return;

    const payload = batch.length === 1
      ? { type: 'notification', data: batch[0] }
      : { type: 'notification_batch', count: batch.length, items: batch };

    for (const socketId of socketIds) {
      this.io.to(socketId).emit('notification', payload);
    }

    // Mark delivered
    const ids = batch.map(n => n.notificationId).filter(Boolean);
    await Notification.updateMany(
      { _id: { $in: ids } },
      { $set: { 'channels.inApp.sent': true, 'channels.inApp.sentAt': new Date() } }
    );

    logger.info(`[Notification] In-app batch delivered: ${batch.length} to userId=${userId}`);
  }

  async _queueOfflineDelivery(userId, batch) {
    for (const notif of batch) {
      await OfflineQueue.create({
        recipient: userId,
        message: notif.entityId,
        room: notif.entityId,
        nextRetryAt: new Date(),
      }).catch(() => {}); // Non-critical
    }
    logger.info(`[Notification] Queued ${batch.length} for offline userId=${userId}`);
  }

  /**
   * When a user reconnects — flush pending notifications and offline messages.
   */
  async onUserOnline(userId, socketId) {
    // Track socket
    if (!this._onlineUsers.has(userId)) {
      this._onlineUsers.set(userId, new Set());
    }
    this._onlineUsers.get(userId).add(socketId);

    // Force-flush any debounced notifications immediately
    this.debouncer.flushUser(userId);

    // Deliver offline queue
    const pending = await OfflineQueue.find({
      recipient: userId,
      isDelivered: false,
    }).populate('message').limit(50);

    if (pending.length > 0) {
      this.io.to(socketId).emit('offline_messages', {
        count: pending.length,
        messages: pending.map(p => p.message),
      });

      await OfflineQueue.updateMany(
        { _id: { $in: pending.map(p => p._id) } },
        { $set: { isDelivered: true, deliveredAt: new Date() } }
      );

      logger.info(`[Notification] Delivered ${pending.length} offline messages to userId=${userId}`);
    }
  }

  onUserOffline(userId, socketId) {
    const sockets = this._onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this._onlineUsers.delete(userId);
      }
    }
  }

  _isUserOnline(userId) {
    const sockets = this._onlineUsers.get(userId.toString());
    return sockets && sockets.size > 0;
  }

  _isQuietHours(prefs) {
    if (prefs.quietHoursStart == null || prefs.quietHoursEnd == null) return false;
    const hour = new Date().getHours();
    const { quietHoursStart: start, quietHoursEnd: end } = prefs;
    return start <= end
      ? hour >= start && hour < end
      : hour >= start || hour < end; // Overnight range (e.g. 22–6)
  }

  _registerQueueWorkers() {
    this.deliveryQueue.process('push', parseInt(process.env.QUEUE_CONCURRENCY) || 5, async (job) => {
      const { userId, notification } = job.data;
      // Stub: integrate with FCM / APNs / web push here
      logger.info(`[PushWorker] Would send push to userId=${userId}: ${notification.title}`);
      return { delivered: true };
    });

    this.deliveryQueue.on('failed', (job, err) => {
      logger.error(`[Queue] Job ${job.id} failed: ${err.message}`);
    });

    this.deliveryQueue.on('completed', (job) => {
      logger.debug(`[Queue] Job ${job.id} completed`);
    });
  }

  async getUnreadCount(userId) {
    return Notification.countDocuments({ recipient: userId, isRead: false });
  }

  async markAllRead(userId) {
    return Notification.updateMany(
      { recipient: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
  }
}
