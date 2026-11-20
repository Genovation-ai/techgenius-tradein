import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";

interface Bucket {
  count: number;
  resetAt: number;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Calls this server makes to itself — the MCP tools replaying a request on
 * loopback. The outer MCP request is already limited per credential; counting
 * the inner calls again by IP would put every assistant in one shared bucket.
 * The TCP peer is checked, not a header, so this cannot be claimed from outside.
 */
function isInternal(req: Request): boolean {
  return LOOPBACK.has(String(req.socket.remoteAddress || "")) && !req.headers["x-forwarded-for"];
}

/** Rate-limit by API key / bearer token instead of IP (hashed; never stored raw). */
export function credentialKey(req: Request): string {
  const header = req.headers["x-api-key"];
  const auth = req.headers.authorization;
  const token =
    typeof header === "string" && header
      ? header
      : typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")
        ? auth.slice(7).trim()
        : "";
  return token ? `cred:${createHash("sha256").update(token).digest("hex").slice(0, 24)}` : `ip:${req.ip}`;
}

/**
 * Minimal fixed-window in-memory rate limiter (no external deps).
 * Suitable for a single-process deployment. For horizontal scaling,
 * swap the Map for a shared store (Redis).
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  message?: string;
  /** Bucket key; defaults to the client IP. */
  keyBy?: (req: Request) => string;
}) {
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
    if (isInternal(req)) return next();
    const now = Date.now();
    // req.ip honours the app's trust-proxy setting, so it is the address the
    // proxy saw. The first X-Forwarded-For entry, used before, is whatever the
    // caller chose to send, which made every limit trivially bypassable.
    const who = opts.keyBy ? opts.keyBy(req) : `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
    const key = `${who}:${req.baseUrl}${req.path}`;

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
