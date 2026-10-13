import { Router } from "express";
import { rateLimit } from "../middleware/rateLimit.js";
import { resolve, suggest } from "../services/geocode.js";

/**
 * Address lookup for the people entering one.
 *
 * Public, because the person who most needs it is a customer typing their
 * own address into a shop's widget, and they have no key. That makes it a
 * door onto someone else's free service, so it is paced on our side as well
 * as theirs: a limiter here, a cache and a one-per-second ceiling in the
 * service, so our traffic to OpenStreetMap stays inside what its operators
 * ask for however hard this endpoint is pushed.
 */
export const geoRouter = Router();

const lookupLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

/** Suggestions while someone types. */
geoRouter.get("/suggest", lookupLimiter, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const country = String(req.query.country ?? "CA").slice(0, 2).toUpperCase();
  if (q.length < 3) return res.json({ results: [] });
  res.json({ results: await suggest(q, country) });
});

/** One address, resolved, for checking before a label is bought. */
geoRouter.get("/resolve", lookupLimiter, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const country = String(req.query.country ?? "CA").slice(0, 2).toUpperCase();
  const hit = await resolve(q, country);
  if (!hit) return res.status(404).json({ error: "No address matched that." });
  res.json(hit);
});
