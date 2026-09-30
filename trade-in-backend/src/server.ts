import express from "express";
import cors from "cors";
import { getDb, migrate } from "./db/migrate.js";
import { seedCatalog } from "./db/seed.js";
import { hydrateCatalogIfFresh } from "./db/hydrate.js";
import { seedRepairMarketPrices } from "./db/patches.js";
import { ensureSecrets, reportSecrets } from "./bootSecrets.js";
import { apiKeyAuth } from "./middleware/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { offersRouter } from "./routes/offers.js";
import { repairPublicRouter, repairsRouter } from "./routes/repairs.js";
import { customersRouter } from "./routes/customers.js";
import { inventoryRouter } from "./routes/inventory.js";
import { pricingRouter } from "./routes/pricing.js";
import { settingsRouter } from "./routes/settings.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { scraperRouter } from "./routes/scraper.js";
import { widgetRouter } from "./routes/widget.js";
import { authRouter, seedAdminUser } from "./routes/auth.js";
import { saasRouter } from "./routes/saas.js";
import { reportsRouter } from "./routes/reports.js";
import { notificationsRouter } from "./routes/notifications.js";
import { searchRouter } from "./routes/search.js";
import { teamRouter, seedStaffRoles } from "./routes/team.js";
import { invoicesRouter } from "./routes/invoices.js";
import { payoutsRouter } from "./routes/payouts.js";
import { bulkRouter } from "./routes/bulk.js";
import { uploadsRouter } from "./routes/uploads.js";
import { integrationsRouter } from "./routes/integrations.js";
import { cronRouter, pricingEngineRouter } from "./routes/cron.js";
import { requireCapability } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { ensureCompetitorSourcesSeeded } from "./services/competitorPricing.js";
import { startWeeklyScrapeScheduler } from "./jobs/weeklyScrape.js";

migrate();
seedCatalog();
{
  // A brand-new volume seeds ~63 devices; the real catalog is ~416. Fill it in
  // before serving, so a fresh deploy is a working shop rather than a quiet
  // fraction of one. No-ops once any offer exists.
  const boot = getDb();
  try {
    // Before anything reads a key: a deployment given no secrets gets its own
    // rather than the public defaults, so the guard below has nothing to
    // refuse and nothing insecure is ever served.
    reportSecrets(ensureSecrets(boot));
    hydrateCatalogIfFresh(boot);
    // After hydration, never before: these rows are keyed to device ids that
    // only exist once the snapshot is in.
    seedRepairMarketPrices(boot);
  } finally { boot.close(); }
}
seedAdminUser();
seedStaffRoles();
ensureCompetitorSourcesSeeded();
warnOnInsecureDefaults();

const app = express();
app.disable("x-powered-by");
if (process.env.TG_TRUST_PROXY === "1" || process.env.TG_TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

// CORS is split, because the widget and the admin API have opposite needs.
//
// Framer renders an HTML embed inside an `about:srcdoc` iframe, which is an
// opaque origin — the browser sends `Origin: null`, and no allowlist can ever
// name it. Locking the whole API to techgenius.ca therefore breaks the one
// thing the widget exists to do: a shopper opens /sell, the widget loads, and
// no price ever arrives. The same applies to any other site that embeds it.
//
// So the shopper-facing endpoints accept any origin. They are public by design
// — anyone may browse the catalogue and request a quote — and the data behind
// them is the price list already published on the website. Nothing here reads
// or writes another customer's record.
//
// Everything else keeps the allowlist. That is defence in depth rather than the
// real boundary: those routes require an API key or a session token in a header,
// and header auth is not attached automatically by a browser the way a cookie
// is, so a hostile page cannot ride along on a logged-in staff session.
const corsOrigins = (process.env.TG_CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// /api/health belongs here: the widget calls it before loading the catalogue,
// and treats a failure as "backend is down" and renders nothing. Blocked by
// CORS it always failed, so the catalogue only appeared because the fetch
// usually won the race against the health check. On a slow connection, or when
// the shopper paused before choosing a category, the check landed first and the
// widget sat empty with no error.
// Listed individually rather than by prefix. "/api/saas" as a prefix would also
// open /api/saas/org/api-keys, which hands out a tenant's integration keys —
// exactly the route that must stay closed. Only these three are safe:
// widget-config is what an embedded widget reads to wear the merchant's name,
// and signup / slug-available are the public sign-up form.
const PUBLIC_CORS_PATHS = [
  "/api/health",
  "/api/catalog",
  "/api/quote",
  "/api/widget",
  // The repair flow's public half: the problem list, a price, a booking and
  // the tracker. Missing here, an embedded widget could browse devices and
  // then showed an empty "what's wrong with it" list, because the browser
  // discarded a response carrying no CORS header. The admin half lives under
  // /api/repairs, which this prefix does not match, and stays restricted.
  "/api/repair",
  "/api/saas/widget-config",
  "/api/saas/signup",
  "/api/saas/slug-available",
  "/devices",
  "/embed",
];
const openCors = cors();
const restrictedCors = corsOrigins.length > 0 ? cors({ origin: corsOrigins }) : cors();

app.use((req, res, next) => {
  const isPublic = PUBLIC_CORS_PATHS.some(
    (p) => req.path === p || req.path.startsWith(`${p}/`),
  );
  return isPublic ? openCors(req, res, next) : restrictedCors(req, res, next);
});
app.use(securityHeaders);
app.use(express.json({ limit: "10mb" }));

// Throttle abuse-prone public endpoints.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: "Too many login attempts. Try again in a few minutes." });
const publicWriteLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
const quoteLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

import path from "node:path";
import { existsSync } from "node:fs";

/**
 * Static assets.
 *
 * Everything ships from this one service: the admin portal, the embeddable
 * widget bundle, and the device photos. Splitting them across a second host
 * would buy a CDN we do not need at this volume and cost us a CORS surface and
 * another thing to forget to redeploy.
 *
 * Each path is checked in two places — a self-contained `public/` folder built
 * into the deploy, and the sibling source tree used in local development — so
 * the same code works whether the backend was deployed alone or from the repo.
 */
const HERE = import.meta.dirname;
function firstExisting(...candidates: string[]): string | null {
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

const devicesDir = firstExisting(
  path.resolve(HERE, "../public/devices"),
  path.resolve(HERE, "../../public/devices"),
  path.resolve(HERE, "../../trade-in-platform/public/devices"),
);
if (devicesDir) {
  /*
   * Device photographs: cached, but revalidated before use.
   *
   * These were served with a seven-day max-age, so a browser that had seen a
   * tile once would not ask for it again for a week. Three corrections to the
   * iPhone 17 Pro Max tile went out and the shop saw the same broken picture
   * every time, because the fixes were live and their browser never looked.
   * The embed script had exactly this bug and exactly this fix.
   *
   * no-cache does not mean "do not cache" — the file is still stored and
   * still answered from disk on a 304, which for an unchanged image is a
   * request with no body. What it buys is that a corrected picture appears
   * the moment it ships rather than up to a week later.
   */
  app.use(
    "/devices",
    express.static(devicesDir, {
      etag: true,
      lastModified: true,
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      },
    }),
  );
} else {
  console.warn("[static] device images not found — the widget will render broken images");
}

// The built widget bundle the Framer page loads.
//
// Freshly-built output wins over the committed copy in framer-deliverable/.
// That copy is a hand-off convenience and goes stale the moment anyone edits
// the widget without re-exporting it — and a stale bundle here is invisible,
// because the file still serves a 200 and the widget still works, just as it
// did last month. Only fall back to it when there is no build to serve.
const embedDir = firstExisting(
  path.resolve(HERE, "../public/embed"),
  path.resolve(HERE, "../../public/embed"),
  path.resolve(HERE, "../../trade-in-platform/dist-embed-lite"),
  path.resolve(HERE, "../../framer-deliverable"),
);
if (embedDir) {
  /**
   * The embed must not be an hour behind the deployment.
   *
   * tg-trade-in.js has a fixed name — the shop pastes that URL into its site
   * once and never touches it again — so a long max-age means a browser keeps
   * running whatever it downloaded last. Repairs shipped and the shop's own
   * page carried on serving the previous bundle, with no way to tell it not
   * to short of the visitor clearing their cache.
   *
   * no-cache does not mean "do not store": it means revalidate before use.
   * The file is still cached, and an unchanged one comes back as a 304 with
   * no body, so the cost is one conditional request while a deploy reaches
   * every visitor on their next page load. The hashed assets under the admin
   * app keep their long cache; this applies only to the two entry files a
   * host page references by name.
   */
  app.use(
    "/embed",
    express.static(embedDir, {
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        if (/\.(js|css)$/.test(filePath)) {
          res.setHeader("Cache-Control", "no-cache, must-revalidate");
        }
      },
    }),
  );
} else {
  console.warn("[static] embed bundle not found — /embed will 404");
}

// The admin portal. Mounted last, after the API routes, with a catch-all so
// client-side routes like /admin/offers/TG-123 survive a page refresh instead
// of 404ing on a path the server has never heard of.
const adminDir = firstExisting(
  path.resolve(HERE, "../public/admin"),
  path.resolve(HERE, "../../public/admin"),
  path.resolve(HERE, "../../trade-in-platform/dist"),
);

// Health has to actually check something. A static 200 means an uptime monitor
// and the host's own health probe both stay green while the mounted volume is
// missing and every real request fails — the container is never restarted and
// nobody is paged. So touch the database, and answer 503 when it is unreachable
// so schedulers and monitors react. Kept cheap: this runs every few minutes.
app.get("/api/health", (_req, res) => {
  let database = "ok";
  let devices = -1;
  try {
    const db = getDb();
    try {
      devices = (db.prepare("SELECT COUNT(*) AS c FROM devices WHERE enabled = 1").get() as { c: number }).c;
      if (devices === 0) database = "empty";
    } finally {
      db.close();
    }
  } catch (err) {
    database = err instanceof Error ? `unreachable: ${err.message}` : "unreachable";
  }

  const healthy = database === "ok";
  // Shape is additive: `status` stays "ok" when healthy, so existing callers
  // and the smoke suite keep working unchanged.
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    version: "1.2.0",
    engine: "Tech Genius Trade-In Backend",
    pricingEngine: true,
    saas: true,
    checks: { database, quotableDevices: devices },
  });
});

// Public endpoints (widget uses these without API key)
app.use("/api/catalog", catalogRouter);
app.post("/api/quote", quoteLimiter, (req, res, next) => { req.url = "/quote"; pricingRouter(req, res, next); });
app.use("/api/widget", publicWriteLimiter, widgetRouter);
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/saas", saasRouter);

// Pricing engine (model quotes + baselines) — API key protected
app.use("/api/pricing-engine", apiKeyAuth, pricingEngineRouter);

// Cron / scheduled jobs — constant-time secret auth, long timeout
app.use("/api/cron", cronRouter);

// Protected endpoints (admin panel / integrations)
app.use("/api/offers", apiKeyAuth, offersRouter);
app.use("/api/repair", repairPublicRouter);
app.use("/api/repairs", apiKeyAuth, repairsRouter);
app.use("/api/customers", apiKeyAuth, customersRouter);
app.use("/api/inventory", apiKeyAuth, inventoryRouter);
app.use("/api/pricing", apiKeyAuth, requireCapability("pricing:read"), pricingRouter);
app.use("/api/settings", apiKeyAuth, settingsRouter);
app.use("/api/dashboard", apiKeyAuth, requireCapability("dashboard:read"), dashboardRouter);
app.use("/api/scraper", apiKeyAuth, requireCapability("scraper:run"), scraperRouter);
app.use("/api/reports", apiKeyAuth, requireCapability("reports:read"), reportsRouter);
app.use("/api/notifications", apiKeyAuth, requireCapability("notifications:read"), notificationsRouter);
app.use("/api/search", apiKeyAuth, requireCapability("search:read"), searchRouter);
app.use("/api/team", apiKeyAuth, teamRouter);
app.use("/api/invoices", apiKeyAuth, invoicesRouter);
app.use("/api/payouts", apiKeyAuth, payoutsRouter);
app.use("/api/bulk", apiKeyAuth, bulkRouter);
app.use("/api/uploads", apiKeyAuth, uploadsRouter);
app.use("/api/integrations", apiKeyAuth, integrationsRouter);

// Admin portal, served after the API so nothing here can shadow /api/*.
if (adminDir) {
  app.use(express.static(adminDir, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    // Never hand index.html to an asset request — a missing image should 404,
    // not silently return HTML that the browser then fails to decode.
    if (path.extname(req.path)) return next();
    res.sendFile(path.join(adminDir, "index.html"));
  });
} else {
  console.warn("[static] admin build not found — only the API is being served");
}

// Malformed JSON bodies -> 400 instead of a stack-trace 500.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && typeof err === "object" && "type" in err && (err as { type?: string }).type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (err && typeof err === "object" && "status" in err && (err as { status?: number }).status === 413) {
    return res.status(413).json({ error: "Payload too large" });
  }
  if (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
  return next();
});

function warnOnInsecureDefaults() {
  const problems: string[] = [];
  if (!process.env.TG_API_KEY) problems.push("TG_API_KEY (master API key) is using the built-in dev default");
  if (!process.env.TG_CRON_SECRET && !process.env.TG_API_KEY) {
    problems.push("TG_CRON_SECRET is using the built-in dev default");
  }
  if (!process.env.TG_ADMIN_PASSWORD) problems.push("TG_ADMIN_PASSWORD is using the built-in dev default");
  if (!problems.length) return;

  const isProd = process.env.NODE_ENV === "production";
  const forceExit = process.env.TG_REQUIRE_SECRETS === "1" || process.env.TG_REQUIRE_SECRETS === "true";

  console.warn("\n⚠️  SECURITY — insecure default secrets:");
  for (const p of problems) console.warn(`   - ${p}`);
  console.warn("   Boot generates these when they are unset, so reaching here means that failed —");
  console.warn("   most likely the database is not writable. Set TG_API_KEY, TG_CRON_SECRET and");
  console.warn("   TG_ADMIN_PASSWORD in the environment to start regardless.\n");

  if (isProd || forceExit) {
    console.error("Refusing to start: production requires real secrets (or set NODE_ENV≠production for local).");
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT || "4100", 10);
const server = app.listen(PORT, () => {
  console.log(`Tech Genius Trade-In Backend running on http://localhost:${PORT}`);
  startWeeklyScrapeScheduler();
});

// A rejected promise nobody awaited terminates the process on modern Node. One
// unlucky background path — a scraper fetch, a CRM webhook — would take the
// quote server down with it and every shopper mid-flow would see a dead widget.
// Log it and keep serving instead: a degraded background job is survivable, an
// offline storefront is not.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (server kept alive):", reason);
});

// An uncaught exception leaves the process in an undefined state, so here we do
// stop — but through the same graceful path, so in-flight requests still finish.
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception — shutting down:", err);
  shutdown("uncaughtException", 1);
});

let shuttingDown = false;
function shutdown(signal: string, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — finishing in-flight requests…`);

  // Hosts send SIGTERM before replacing a container. Without this the socket is
  // cut mid-request and a shopper's submit is lost even though it may already
  // have been written. Stop accepting new connections, let current ones drain.
  server.close(() => {
    console.log("Closed cleanly.");
    process.exit(code);
  });

  // Never hang a deploy waiting on a stuck socket.
  setTimeout(() => {
    console.error("Drain timed out after 10s — exiting anyway.");
    process.exit(code || 1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));