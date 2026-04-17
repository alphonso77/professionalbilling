import IORedis, { Redis } from 'ioredis';
import { env } from './env';

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }
  return _redis;
}

export const redis = getRedis();
