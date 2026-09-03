import { createHash, randomBytes } from 'node:crypto';

/**
 * Rate limiting that never stores an IP address (SPEC §8.2).
 *
 * The client address is hashed with a salt that is generated at random on
 * first use and rotated every 24 hours. Only the truncated hash is kept, and
 * the whole bucket map is discarded when the salt rotates. That means:
 *
 *   - no IP is written to memory, disk, logs or telemetry;
 *   - the hash cannot be reversed by an attacker who obtains the process
 *     memory tomorrow, because yesterday's salt is gone;
 *   - a dictionary attack over the IPv4 space against a *live* process is the
 *     residual risk, which is accepted for a counter that exists only to stop
 *     someone flooding a public benchmark.
 *
 * Deliberately in-process. A distributed cache would be the production answer
 * for a multi-instance deployment, and `infra/main.bicep` provisions a single
 * Container App revision with session affinity off precisely because a
 * best-effort per-instance limit is sufficient here; the k-anonymity floor and
 * outlier rejection are the defences that actually matter.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000;

interface Bucket {
  count: number;
  firstSeen: number;
}

let salt = randomBytes(32);
let saltRotatedAt = Date.now();
let buckets = new Map<string, Bucket>();

function rotateIfStale(now: number): void {
  if (now - saltRotatedAt < WINDOW_MS) return;
  salt = randomBytes(32);
  saltRotatedAt = now;
  buckets = new Map();
}

/**
 * Derives the opaque bucket key. The raw value is never returned, never
 * logged and never leaves this function.
 */
function keyFor(clientAddress: string): string {
  return createHash('sha256')
    .update(salt)
    .update(clientAddress)
    .digest('base64url')
    .slice(0, 22);
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the caller may retry. Zero when allowed. */
  retryAfter: number;
}

export function checkRateLimit(
  clientAddress: string,
  limit = Number(process.env.BENCHMARK_RATE_LIMIT ?? 20),
  now = Date.now(),
): RateLimitResult {
  rotateIfStale(now);
  const key = keyFor(clientAddress);
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.firstSeen >= WINDOW_MS) {
    buckets.set(key, { count: 1, firstSeen: now });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    const retryAfter = Math.ceil((bucket.firstSeen + WINDOW_MS - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter: Math.max(retryAfter, 1) };
  }

  bucket.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - bucket.count), retryAfter: 0 };
}

/**
 * Extracts something stable enough to rate-limit on, without persisting it.
 * The value is consumed synchronously by `checkRateLimit` and discarded; it is
 * never attached to the stored document, and X-Forwarded-For is not logged.
 */
export function clientAddressOf(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get('x-azure-clientip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  );
}

/** Test seam — forces a rotation so tests need not wait 24 hours. */
export function __resetRateLimit(): void {
  salt = randomBytes(32);
  saltRotatedAt = Date.now();
  buckets = new Map();
}

/** Test seam — proves the salt actually rotates. */
export function __currentSaltFingerprint(): string {
  return createHash('sha256').update(salt).digest('hex').slice(0, 12);
}

/** Test seam — forces the salt to look stale. */
export function __ageSalt(byMs: number): void {
  saltRotatedAt -= byMs;
}
