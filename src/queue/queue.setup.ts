import { Queue } from 'bullmq';
import { env } from '../config/env';

const redisConnection = {
  host: env.REDIS_HOST,
  port: parseInt(env.REDIS_PORT, 10),
  password: env.REDIS_PASSWORD || undefined,
};

export const notificationQueue = new Queue('notifications', { connection: redisConnection });
