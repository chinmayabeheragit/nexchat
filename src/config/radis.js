// src/config/redis.js
import Redis from 'ioredis';
import logger from '../utils/logger.js';

let redisClient = null;
let subscriberClient = null;  // Separate client for pub/sub

function createRedisClient(name = 'main') {
  const client = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 500, 5000);
      logger.warn(`Redis [${name}] retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    reconnectOnError(err) {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) return true;
      return false;
    },
    lazyConnect: false,
    enableReadyCheck: true,
    keepAlive: 30000,
  });

  client.on('connect', () => logger.info(`✅ Redis [${name}] connected`));
  client.on('error', (err) => logger.error(`❌ Redis [${name}] error: ${err.message}`));
  client.on('close', () => logger.warn(`⚠️ Redis [${name}] connection closed`));

  return client;
}

export function getRedisClient() {
  if (!redisClient) {
    redisClient = createRedisClient('main');
  }
  return redisClient;
}

export function getSubscriberClient() {
  if (!subscriberClient) {
    subscriberClient = createRedisClient('subscriber');
  }
  return subscriberClient;
}

export async function closeRedisConnections() {
  if (redisClient) await redisClient.quit();
  if (subscriberClient) await subscriberClient.quit();
  logger.info('Redis connections closed');
}

// ─── Helper wrappers with error handling ─────────────────────────────────────
export const redisHelpers = {
  async set(key, value, ttlSeconds = null) {
    const client = getRedisClient();
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      return client.setex(key, ttlSeconds, serialized);
    }
    return client.set(key, serialized);
  },

  async get(key) {
    const client = getRedisClient();
    const raw = await client.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  },

  async del(key) {
    return getRedisClient().del(key);
  },

  async exists(key) {
    return getRedisClient().exists(key);
  },

  async incr(key) {
    return getRedisClient().incr(key);
  },

  async expire(key, seconds) {
    return getRedisClient().expire(key, seconds);
  },

  async hset(hash, field, value) {
    return getRedisClient().hset(hash, field, JSON.stringify(value));
  },

  async hget(hash, field) {
    const raw = await getRedisClient().hget(hash, field);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  },

  async hgetall(hash) {
    const raw = await getRedisClient().hgetall(hash);
    if (!raw) return null;
    const result = {};
    for (const [k, v] of Object.entries(raw)) {
      try { result[k] = JSON.parse(v); } catch { result[k] = v; }
    }
    return result;
  },

  async hdel(hash, field) {
    return getRedisClient().hdel(hash, field);
  },

  async sadd(key, ...members) {
    return getRedisClient().sadd(key, ...members);
  },

  async smembers(key) {
    return getRedisClient().smembers(key);
  },

  async srem(key, member) {
    return getRedisClient().srem(key, member);
  },

  async publish(channel, message) {
    return getRedisClient().publish(channel, JSON.stringify(message));
  },
};

export default { getRedisClient, getSubscriberClient, redisHelpers };
