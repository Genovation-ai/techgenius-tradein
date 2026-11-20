import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { credentialKey, rateLimit } from "../middleware/rateLimit.js";

/**
 * The limiter used to key on the first X-Forwarded-For entry, which the client
 * writes, so rotating that header skipped every limit (login, signup, quotes).
 */

function fakeReq(opts: { ip: string; peer?: string; xff?: string; key?: string }): Request {
  return {
    ip: opts.ip,
    socket: { remoteAddress: opts.peer ?? "10.0.0.5" },
    headers: { ...(opts.xff ? { "x-forwarded-for": opts.xff } : {}), ...(opts.key ? { "x-api-key": opts.key } : {}) },
    baseUrl: "/api/auth",
    path: "/login",
  } as unknown as Request;
}

function fakeRes() {
  const r = { statusCode: 200, headers: {} as Record<string, string> };
  const res = {
    setHeader: (k: string, v: string) => {
      r.headers[k] = v;
    },
    status(code: number) {
      r.statusCode = code;
      return { json: () => undefined };
    },
  } as unknown as Response;
  return { res, r };
}

function hit(limiter: ReturnType<typeof rateLimit>, req: Request): number {
  const { res, r } = fakeRes();
  let passed = false;
  limiter(req, res, () => {
    passed = true;
  });
  return passed ? 200 : r.statusCode;
}

describe("rate limiter", () => {
  it("cannot be bypassed by rotating X-Forwarded-For", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 3 });
    const codes = ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5"].map((fake) =>
      hit(limiter, fakeReq({ ip: "203.0.113.9", xff: `${fake}, 203.0.113.9` })),
    );
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it("does not count the server's own loopback calls", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 });
    const codes = [1, 2, 3].map(() => hit(limiter, fakeReq({ ip: "127.0.0.1", peer: "127.0.0.1" })));
    expect(codes).toEqual([200, 200, 200]);
  });

  it("a loopback peer that carries a forwarded header is still counted", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1 });
    const codes = [1, 2].map(() => hit(limiter, fakeReq({ ip: "198.51.100.7", peer: "127.0.0.1", xff: "198.51.100.7" })));
    expect(codes).toEqual([200, 429]);
  });

  it("per-credential buckets keep two keys behind one IP apart", () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyBy: credentialKey });
    expect(hit(limiter, fakeReq({ ip: "192.0.2.1", key: "tg_live_aaa" }))).toBe(200);
    expect(hit(limiter, fakeReq({ ip: "192.0.2.1", key: "tg_live_bbb" }))).toBe(200);
    expect(hit(limiter, fakeReq({ ip: "192.0.2.1", key: "tg_live_aaa" }))).toBe(429);
  });
});
