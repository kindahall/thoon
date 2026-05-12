type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
};

type RateLimitInput = {
  key: string;
  limit: number;
  name: string;
  windowMs: number;
};

const buckets = new Map<string, RateLimitBucket>();
const maxBuckets = 5000;

export function checkRateLimit(input: RateLimitInput): RateLimitResult {
  const now = Date.now();
  const bucketKey = `${input.name}:${input.key}`;
  const current = buckets.get(bucketKey);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + input.windowMs };

  bucket.count += 1;
  buckets.set(bucketKey, bucket);
  pruneExpiredBuckets(now);

  const remaining = Math.max(input.limit - bucket.count, 0);
  const retryAfterSeconds = Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1);

  return {
    allowed: bucket.count <= input.limit,
    limit: input.limit,
    remaining,
    resetAt: new Date(bucket.resetAt).toISOString(),
    retryAfterSeconds,
  };
}

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': result.resetAt,
  };

  if (!result.allowed) {
    headers['Retry-After'] = String(result.retryAfterSeconds);
  }

  return headers;
}

function pruneExpiredBuckets(now: number) {
  if (buckets.size <= maxBuckets) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  if (buckets.size <= maxBuckets) {
    return;
  }

  for (const key of buckets.keys()) {
    buckets.delete(key);

    if (buckets.size <= maxBuckets) {
      return;
    }
  }
}
