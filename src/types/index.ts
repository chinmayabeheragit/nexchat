export interface DBConnectionStatus {
  isConnected: boolean;
  readyState: number;
  states: any;
  host: string;
  name: string;
}

export interface RedisHelpers {
  set(key: string, value: unknown, ttlSeconds?: number): Promise<string | null>;
  get<T = unknown>(key: string): Promise<T | null>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  hset(hash: string, field: string, value: unknown): Promise<number>;
  hget<T = unknown>(hash: string, field: string): Promise<T | null>;
  hgetall<T = Record<string, unknown>>(hash: string): Promise<T | null>;
  hdel(hash: string, field: string): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, member: string): Promise<number>;
  publish(channel: string, message: unknown): Promise<number>;
}
