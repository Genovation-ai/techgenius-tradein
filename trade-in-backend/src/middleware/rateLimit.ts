import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal fixed-window in-memory rate limiter (no external deps).
 * Suitable for a single-process deployment. For horizontal scaling,
 * swap the Map for a shared store (Redis).
 */
export function rateLimit(opts: { windowMs: number; max: number; message?: string }) {
  const windowMs = opts.windowMs;
  const max = opts.max;
  const message = opts.message || "Too many requests. Please try again later.";
  const buckets = new Map<string, Bucket>();

  // Periodic cleanup so the map doesn't grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  // Do not keep the event loop alive just for the sweeper.
  if (typeof sweep.unref === "function") sweep.unref();

  return function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const key = `${ip}:${req.baseUrl}${req.path}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message, retry_after_seconds: retryAfter });
    }
    return next();
  };
}
