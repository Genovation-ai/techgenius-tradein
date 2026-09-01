import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Constant-time shared-secret auth for cron endpoints.
 * Accepts header `x-cron-secret` or `Authorization: Bearer <secret>`.
 */
export function cronSecretAuth(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.TG_CRON_SECRET || process.env.TG_API_KEY || "tg-dev-key-2026";
  const provided =
    (req.headers["x-cron-secret"] as string | undefined) ||
    (typeof req.headers.authorization === "string" &&
    req.headers.authorization.toLowerCase().startsWith("bearer ")
      ? req.headers.authorization.slice(7).trim()
      : "") ||
    "";

  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: "Invalid cron secret" });
  }
  return next();
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // still do a compare to reduce timing signal on length alone
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}
