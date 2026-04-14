import Redis, { RedisOptions } from 'ioredis';
import logger from '../utils/logger';
import { env } from './env';
import type { RedisHelpers } from '../types';

// ─── Client factory ───────────────────────────────────────────────────────────
function createRedisClient(name: string = 'main'): Redis {
  const options: RedisOptions = {
    host: env.REDIS_HOST,
    port: parseInt(env.REDIS_PORT, 10),
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number): number {
      const delay = Math.min(times * 500, 5000);
      logger.warn(`Redis [${name}] retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    reconnectOnError(err: Error): boolean {
      // Reconnect on READONLY errors (e.g. Redis replica promotion)
      return err.message.includes('READONLY');
    },
    lazyConnect: false,
    enableReadyCheck: true,
    keepAlive: 30_000,
  };

  const client = new Redis(options);

  client.on('connect',      ()    => logger.info(`✅ Redis [${name}] connected`));
  client.on('error',        (err) => logger.error(`❌ Redis [${name}] error: ${err.message}`));
  client.on('close',        ()    => logger.warn(`⚠️  Redis [${name}] connection closed`));
  client.on('reconnecting', ()    => logger.info(`🔄 Redis [${name}] reconnecting...`));

  return client;
}

// ─── Singleton clients ────────────────────────────────────────────────────────
let redisClient: Redis | null = null;
let subscriberClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = createRedisClient('main');
  }
  return redisClient;
}

export function getSubscriberClient(): Redis {
  if (!subscriberClient) {
    subscriberClient = createRedisClient('subscriber');
  }
  return subscriberClient;
}

export async function closeRedisConnections(): Promise<void> {
  if (redisClient)    await redisClient.quit();
  if (subscriberClient) await subscriberClient.quit();
  redisClient = null;
  subscriberClient = null;
  logger.info('Redis connections closed');
}

// ─── Helper wrappers ──────────────────────────────────────────────────────────
// Generic typed wrappers — all serialization/deserialization handled here
// so the rest of the app never calls raw ioredis directly.

export const redisHelpers: RedisHelpers = {
  // ── String ops ──────────────────────────────────────────────────────────────
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<string | null> {
    const client = getRedisClient();
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      return client.setex(key, ttlSeconds, serialized);
    }
    return client.set(key, serialized);
  },

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await getRedisClient().get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  },

  async del(key: string): Promise<number> {
    return getRedisClient().del(key);
  },

  async exists(key: string): Promise<number> {
    return getRedisClient().exists(key);
  },

  async incr(key: string): Promise<number> {
    return getRedisClient().incr(key);
  },

  async expire(key: string, seconds: number): Promise<number> {
    return getRedisClient().expire(key, seconds);
  },

  // ── Hash ops ─────────────────────────────────────────────────────────────────
  async hset(hash: string, field: string, value: unknown): Promise<number> {
    return getRedisClient().hset(hash, field, JSON.stringify(value));
  },

  async hget<T = unknown>(hash: string, field: string): Promise<T | null> {
    const raw = await getRedisClient().hget(hash, field);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  },

  async hgetall<T = Record<string, unknown>>(hash: string): Promise<T | null> {
    const raw = await getRedisClient().hgetall(hash);
    if (!raw || Object.keys(raw).length === 0) return null;

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      try {
        result[k] = JSON.parse(v);
      } catch {
        result[k] = v;
      }
    }
    return result as T;
  },

  async hdel(hash: string, field: string): Promise<number> {
    return getRedisClient().hdel(hash, field);
  },

  // ── Set ops ──────────────────────────────────────────────────────────────────
  async sadd(key: string, ...members: string[]): Promise<number> {
    return getRedisClient().sadd(key, ...members);
  },

  async smembers(key: string): Promise<string[]> {
    return getRedisClient().smembers(key);
  },

  async srem(key: string, member: string): Promise<number> {
    return getRedisClient().srem(key, member);
  },

  // ── Pub/Sub ──────────────────────────────────────────────────────────────────
  async publish(channel: string, message: unknown): Promise<number> {
    return getRedisClient().publish(channel, JSON.stringify(message));
  },
};

export default { getRedisClient, getSubscriberClient, redisHelpers };