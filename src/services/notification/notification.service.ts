import { Notification } from '../../models/Notification';

export class NotificationService {
  static async getNotifications(userId: string, filterUnread = false, limit = 20, page = 1) {
    const filter: any = { recipient: userId };
    if (filterUnread) filter.isRead = false;

    const items = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('sender', 'username avatar');
    
    const total = await Notification.countDocuments(filter);
    return { items, total, pages: Math.ceil(total / limit) };
  }

  static async markAllAsRead(userId: string) {
    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
  }

  static async markAsRead(notificationId: string, userId: string) {
    await Notification.updateOne(
      { _id: notificationId, recipient: userId },
      { $set: { isRead: true, readAt: new Date() } }
    );
  }
}
