import { Redis } from "ioredis";
import { env } from "./env.js";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }
  return redis;
}

export async function connectRedis(): Promise<void> {
  const client = getRedis();
  if (client.status !== "ready") {
    await client.connect();
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

const REFRESH_PREFIX = "refresh:";
const ADMIN_REFRESH_PREFIX = "admin_refresh:";

export function refreshKey(tokenId: string): string {
  return `${REFRESH_PREFIX}${tokenId}`;
}

export function adminRefreshKey(tokenId: string): string {
  return `${ADMIN_REFRESH_PREFIX}${tokenId}`;
}

export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
