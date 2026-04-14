import { Request, Response } from 'express';
import { ChatService } from './chat.service';
import { ApiResponse } from '../../utils/apiResponse';

export class ChatController {
  static async createRoom(req: Request, res: Response) {
    // @ts-ignore
    const room = await ChatService.createRoom(req.body, req.user.userId);
    res.status(201).json(ApiResponse.success(room));
  }

  static async getRooms(req: Request, res: Response) {
    // @ts-ignore
    const rooms = await ChatService.getRooms(req.user.userId);
    res.json(ApiResponse.success(rooms));
  }

  static async getMessages(req: Request, res: Response) {
    const messages = await ChatService.getMessages(req.params.roomId as string);
    res.json(ApiResponse.success(messages));
  }
  
  static async searchMessages(req: Request, res: Response) {
    // @ts-ignore
    const results = await ChatService.searchMessages(req.query.q as string, req.user.userId);
    res.json(ApiResponse.success(results));
  }
}
