import { Router } from 'express';
import { UserController } from './user.controller';
import { validate } from '../../middleware/validate.middleware';
import { updatePrefsSchema } from './user.schema';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

router.use(authenticate);
router.get('/me', UserController.getProfile);
router.patch('/me/notifications', validate(updatePrefsSchema), UserController.updatePrefs);

export default router;
