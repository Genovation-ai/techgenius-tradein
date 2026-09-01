import type { Request, Response, NextFunction } from "express";

/**
 * Baseline HTTP hardening headers for the API + static image host.
 * No third-party dependency — intentionally lightweight.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // widget embeds may pull /devices
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  // API responses are JSON — keep CSP restrictive for document navigations.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}
