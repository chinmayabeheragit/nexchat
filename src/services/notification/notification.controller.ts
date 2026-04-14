import { Request, Response } from 'express';
import { NotificationService } from './notification.service';
import { ApiResponse } from '../../utils/apiResponse';

export class NotificationController {
  static async getNotifications(req: Request, res: Response) {
    const { page = 1, limit = 20, unreadOnly = 'false' } = req.query;
    // @ts-ignore
    const result = await NotificationService.getNotifications(req.user.userId, unreadOnly === 'true', Number(limit), Number(page));
    res.json(ApiResponse.success(result));
  }

  static async markAllAsRead(req: Request, res: Response) {
    // @ts-ignore
    await NotificationService.markAllAsRead(req.user.userId);
    res.json(ApiResponse.success(null, 'Marked all as read'));
  }

  static async markAsRead(req: Request, res: Response) {
    // @ts-ignore
    await NotificationService.markAsRead(req.params.id, req.user.userId);
    res.json(ApiResponse.success(null, 'Notification marked as read'));
  }
}
