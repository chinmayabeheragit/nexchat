import { Request, Response } from 'express';
import { UserService } from './user.service';
import { ApiResponse } from '../../utils/apiResponse';

export class UserController {
  static async getProfile(req: Request, res: Response) {
    try {
      // @ts-ignore
      const user = await UserService.getProfile(req.user.userId);
      res.json(ApiResponse.success(user));
    } catch (err: any) {
      if (err.message === 'User not found') {
        res.status(404).json(ApiResponse.error('User not found'));
      } else {
        res.status(500).json(ApiResponse.error(err.message));
      }
    }
  }

  static async updatePrefs(req: Request, res: Response) {
    try {
      // @ts-ignore
      await UserService.updatePrefs(req.user.userId, req.body);
      res.json(ApiResponse.success(null, 'Notification preferences updated'));
    } catch (err: any) {
      res.status(500).json(ApiResponse.error(err.message));
    }
  }
}
