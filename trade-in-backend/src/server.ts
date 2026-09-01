import express from "express";
import cors from "cors";
import { getDb, migrate } from "./db/migrate.js";
import { seedCatalog } from "./db/seed.js";
import { apiKeyAuth } from "./middleware/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { offersRouter } from "./routes/offers.js";
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
seedAdminUser();
seedStaffRoles();
ensureCompetitorSourcesSeeded();
warnOnInsecureDefaults();

const app = express();
app.disable("x-powered-by");
if (process.env.TG_TRUST_PROXY === "1" || process.env.TG_TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

// CORS: permissive by default for the public embeddable widget. Auth uses
// header tokens (not cookies), so a wildcard origin does not enable CSRF.
// Set TG_CORS_ORIGINS to a comma-separated allowlist to lock it down.
const corsOrigins = (process.env.TG_CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors(
    corsOrigins.length > 0
      ? { origin: corsOrigins }
      : undefined,
  ),
);
app.use(securityHeaders);
app.use(express.json({ limit: "10mb" }));

// Throttle abuse-prone public endpoints.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: "Too many login attempts. Try again in a few minutes." });
const publicWriteLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
const quoteLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

// Serve device images statically
import path from "node:path";
app.use("/devices", express.static(path.resolve(import.meta.dirname, "../../trade-in-platform/public/devices")));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "1.2.0",
    engine: "Tech Genius Trade-In Backend",
    pricingEngine: true,
    saas: true,
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
  console.warn("   Set TG_API_KEY, TG_CRON_SECRET, and TG_ADMIN_PASSWORD before public deploy.\n");

  if (isProd || forceExit) {
    console.error("Refusing to start: production requires real secrets (or set NODE_ENV≠production for local).");
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT || "4100", 10);
app.listen(PORT, () => {
  console.log(`Tech Genius Trade-In Backend running on http://localhost:${PORT}`);
  startWeeklyScrapeScheduler();
});