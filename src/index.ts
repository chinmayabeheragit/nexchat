import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import app from './gateway/index';
import { connectDB } from './config/db';
import { env } from './config/env';
import logger from './utils/logger';

const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: {
    origin: env.CLIENT_ORIGINS || 'http://localhost:3000',
    credentials: true,
  },
});

async function bootstrap() {
  try {
    await connectDB();
    logger.info('Database connected successfully');

    const PORT = env.PORT || 5000;
    httpServer.listen(PORT, () => {
      logger.info(`Server listening on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();
