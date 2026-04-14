import { Worker } from 'bullmq';
import { env } from '../../config/env';
import logger from '../../utils/logger';

const redisConnection = {
  host: env.REDIS_HOST,
  port: parseInt(env.REDIS_PORT, 10),
  password: env.REDIS_PASSWORD || undefined,
};

export const notificationWorker = new Worker('notifications', async job => {
  logger.info(`Processing notification job ${job.id}`);
  // Notification dispatch logic (Email / Push)
}, { connection: redisConnection });

notificationWorker.on('completed', job => logger.info(`Job ${job.id} completed!`));
notificationWorker.on('failed', (job, err) => logger.error(`Job ${job?.id} failed with ${err.message}`));
