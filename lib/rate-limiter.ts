import { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';

const REDIS_DISABLED =
  process.env.DISABLE_REDIS === 'true' || process.env.REDIS_DISABLED === 'true';

let redisClient: Redis | any;
let limiter: any;

if (!REDIS_DISABLED) {
  redisClient = new Redis(process.env.REDIS_URL!, {
    enableAutoPipelining: true,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  redisClient.on('error', (err: unknown) => console.error('Redis Client Error', err));
  limiter = new RateLimiterRedis({
    storeClient: redisClient,
    keyPrefix: 'api_limit',
    points: 2,
    duration: 1,
  });
} else {
  redisClient = { get: async (_: string) => null, set: async (_: string, __: string) => null, on: () => null } as unknown as Redis;
  limiter = new RateLimiterMemory({ points: 2, duration: 1 });
}

export async function checkRateLimit(ip: string): Promise<void> {
  await limiter.consume(ip);
}

function log(message: string) {
  if (process.env.DEBUG_API === 'true') {
    console.log(`[API] ${message}`);
  }
}

export { redisClient, log };
