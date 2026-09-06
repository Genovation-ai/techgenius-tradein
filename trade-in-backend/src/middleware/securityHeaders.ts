import type { Request, Response, NextFunction } from "express";

/**
 * Baseline HTTP hardening headers for the API + static image host.
 * No third-party dependency — intentionally lightweight.
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // widget embeds may pull /devices
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );

  // Two policies, because this service answers two very different things.
  //
  // `default-src 'none'` is right for a JSON API and wrong for an HTML app: it
  // blocks the admin portal's own bundle, so the page loads and renders nothing
  // at all. Keep the strict policy on /api/*, and give the portal a policy that
  // permits exactly what it needs and no more.
  const isApi = req.path.startsWith("/api/");
  res.setHeader(
    "Content-Security-Policy",
    isApi
      ? "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"
      : [
          "default-src 'self'",
          "script-src 'self'",
          // Vite inlines a small style block, and the portal loads Google Fonts.
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com data:",
          // data:/blob: cover generated device silhouettes and upload previews.
          "img-src 'self' data: blob:",
          "connect-src 'self'",
          "frame-ancestors 'self'",
          "base-uri 'none'",
          "form-action 'self'",
          "object-src 'none'",
        ].join("; "),
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}
