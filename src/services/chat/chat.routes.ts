import { Router } from 'express';
import { ChatController } from './chat.controller';
import { validate } from '../../middleware/validate.middleware';
import { createRoomSchema, searchMessagesSchema } from './chat.schema';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
router.use(authenticate);

router.post('/rooms', validate(createRoomSchema), ChatController.createRoom);
router.get('/rooms', ChatController.getRooms);
router.get('/rooms/:roomId/messages', ChatController.getMessages);
router.get('/messages/search', validate(searchMessagesSchema), ChatController.searchMessages);

export default router;
