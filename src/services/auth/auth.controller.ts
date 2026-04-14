import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ApiResponse } from '../../utils/apiResponse';
import logger from '../../utils/logger';

export class AuthController {
  static async register(req: Request, res: Response) {
    try {
      const result = await AuthService.register(req.body);
      logger.info(`[Auth] New user registered: ${req.body.username}`);
      res.status(201).json(ApiResponse.success(result));
    } catch (err: any) {
      if (err.message.includes('already') || err.message.includes('taken')) {
        res.status(409).json(ApiResponse.error(err.message));
      } else {
        throw err;
      }
    }
  }

  static async login(req: Request, res: Response) {
    try {
      const result = await AuthService.login(req.body);
      logger.info(`[Auth] Login: ${req.body.email}`);
      res.json(ApiResponse.success(result));
    } catch (err: any) {
      res.status(401).json(ApiResponse.error(err.message));
    }
  }

  static async logout(req: Request, res: Response) {
    const { refreshToken } = req.body;
    // @ts-ignore
    const userId = req.user.userId;
    await AuthService.logout(userId, refreshToken);
    logger.info(`[Auth] Logout: userId=${userId}`);
    res.json(ApiResponse.success(null, 'Logged out successfully'));
  }
}
