import 'server-only';

// Fail-closed rate limiter for auth endpoints.
//
// With UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set, counters live in
// Upstash Redis (plain REST) and survive cold starts and multiple instances.
// Otherwise an in-process sliding window is used (resets per instance).

const inMemory = new Map<string, number[]>();

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

function clientIp(request: Request): string {
  const h = request.headers;
  // Vercel sets x-vercel-forwarded-for itself; x-forwarded-for is client-spoofable.
  return (
    h.get('x-vercel-forwarded-for') ||
    h.get('x-real-ip') ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function clientKey(request: Request, email: string): string {
  return `rl:${clientIp(request)}|${email.toLowerCase().trim()}`;
}

async function upstash(cmd: string, args: Array<string | number>): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const path = args.map((a) => encodeURIComponent(String(a))).join('/');
    const res = await fetch(`${url}/${cmd}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: unknown; error?: unknown };
    return data.error == null ? (data.result ?? null) : null;
  } catch {
    return null;
  }
}

async function checkUpstash(
  key: string,
  attempts: number,
  windowMs: number,
): Promise<RateLimitResult | null> {
  const seconds = Math.ceil(windowMs / 1000);
  const count = await upstash('incr', [key]);
  if (typeof count !== 'number') return null; // not configured / unreachable
  await upstash('expire', [key, seconds, 'nx']);
  return count > attempts
    ? { allowed: false, retryAfter: seconds }
    : { allowed: true, retryAfter: 0 };
}

export function checkInMemory(
  key: string,
  attempts: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const timestamps = (inMemory.get(key) ?? []).filter((t) => now - t < windowMs);

  if (timestamps.length >= attempts) {
    inMemory.set(key, timestamps);
    const oldest = timestamps[0] ?? now;
    return {
      allowed: false,
      retryAfter: Math.max(Math.ceil((windowMs - (now - oldest)) / 1000), 1),
    };
  }

  timestamps.push(now);
  inMemory.set(key, timestamps);

  // Keep the map from growing without bound on a long-lived instance.
  if (inMemory.size > 5000) {
    for (const [k, v] of inMemory) {
      if (v.every((t) => now - t >= windowMs)) inMemory.delete(k);
    }
  }
  return { allowed: true, retryAfter: 0 };
}

/** Records one attempt for IP+email and reports whether it is permitted. */
export async function checkRateLimit(
  request: Request,
  {
    email,
    attempts = DEFAULT_ATTEMPTS,
    windowMs = DEFAULT_WINDOW_MS,
  }: { email: string; attempts?: number; windowMs?: number },
): Promise<RateLimitResult> {
  const key = clientKey(request, email);
  return (await checkUpstash(key, attempts, windowMs)) ?? checkInMemory(key, attempts, windowMs);
}
