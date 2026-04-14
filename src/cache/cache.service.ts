import { getRedisClient } from '../config/redis';

export class CacheService {
  static async get(key: string) {
    const data = await getRedisClient().get(key);
    return data ? JSON.parse(data) : null;
  }
  static async set(key: string, value: any, ttlSeconds?: number) {
    const data = JSON.stringify(value);
    if (ttlSeconds) await getRedisClient().setex(key, ttlSeconds, data);
    else await getRedisClient().set(key, data);
  }
  static async del(key: string) {
    await getRedisClient().del(key);
  }
}
