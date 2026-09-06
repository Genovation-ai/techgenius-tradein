/**
 * Cross-tenant isolation guard.
 *
 * Multi-tenant leaks are silent: nothing errors, nothing looks wrong, one
 * tenant simply sees another's customers. This platform shipped with eight
 * route files that never filtered by org at all, and it was invisible until
 * someone went looking with two API keys.
 *
 * So this goes in the gate suite. It stands up two tenants, gives one of them
 * real data, and asserts the other cannot see it through any endpoint that
 * returns customer or commercial records — then asserts the owner still can, so
 * a filter that hides everything from everybody fails too.
 *
 * Run: npm run test:isolation   (server must be running)
 */
const API = process.env.API || `http://localhost:${process.env.TG_API_PORT || 4100}`;
const MARKER = "IsolationCanary";
const EMAIL = "isolation-canary@example.invalid";

interface Tenant {
  slug: string;
  key: string;
}

async function json(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as unknown, raw: text };
  } catch {
    return { status: res.status, body: null, raw: text };
  }
}

async function tenant(name: string): Promise<Tenant> {
  const slug = `iso-guard-${name}`;
  const r = await json("/api/saas/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_name: `Isolation Guard ${name}`,
      slug,
      admin_name: name,
      email: `${name}@isolation-guard.invalid`,
      password: "IsolationGuard2026!Sec",
    }),
  });
  const key = r.body?.api_key?.key ?? r.body?.api_key;
  if (typeof key === "string" && key) return { slug, key };

  // Already exists from a previous run — mint a fresh key via the existing org.
  throw new Error(
    `could not provision tenant "${slug}": ${r.status} ${r.raw.slice(0, 160)}\n` +
      `If it already exists, delete rows for slug ${slug} or use a clean database.`,
  );
}

const failures: string[] = [];
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures.push(label);
}

async function main(): Promise<void> {
  const stamp = Date.now().toString(36);
  const a = await tenant(`a${stamp}`);
  const b = await tenant(`b${stamp}`);
  console.log(`tenants: ${a.slug} / ${b.slug}\n`);

  // Tenant A takes a real trade-in.
  const submit = await json("/api/widget/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-org-slug": a.slug },
    body: JSON.stringify({
      org: a.slug,
      contact: { first_name: MARKER, last_name: "Customer", email: EMAIL, phone: "9055550000" },
      offer_type: "mail-in",
      items: [
        { device_id: "iphone-15", device_name: "iPhone 15", storage: "128GB", condition_grade: "good" },
      ],
    }),
  });
  if (submit.status !== 200 && submit.status !== 201) {
    console.error(`could not seed tenant A: ${submit.status} ${submit.raw.slice(0, 200)}`);
    process.exit(1);
  }

  const leaky = [
    ["offers", "/api/offers"],
    ["offers/leads", "/api/offers/leads"],
    ["customers", "/api/customers"],
    ["search", "/api/search?q=" + MARKER],
    ["invoices", "/api/invoices"],
    ["uploads", "/api/uploads"],
    ["notifications", "/api/notifications"],
  ] as const;

  console.log("B must not see A's records:");
  for (const [label, path] of leaky) {
    const r = await json(path, { headers: { "x-api-key": b.key } });
    // Inspect returned records only. /api/search echoes the query string back
    // in its response, so a raw substring match reports the search term itself
    // as a leak — a false alarm that hides whether any row actually escaped.
    const records = Array.isArray(r.body)
      ? r.body
      : Object.entries((r.body ?? {}) as Record<string, unknown>)
          .filter(([k]) => k !== "q")
          .flatMap(([, v]) => (Array.isArray(v) ? v : []));
    const serialized = JSON.stringify(records);
    const leaked = serialized.includes(MARKER) || serialized.includes(EMAIL);
    check(label, !leaked, leaked ? "<- leaked A's customer" : "");
  }

  const dash = await json("/api/dashboard", { headers: { "x-api-key": b.key } });
  check("dashboard totals", (dash.body?.stats?.total_offers ?? -1) === 0, `sees ${dash.body?.stats?.total_offers}`);

  const rep = await json("/api/reports/summary", { headers: { "x-api-key": b.key } });
  const repTotal = (rep.body?.byStatus ?? []).reduce((s: number, r: any) => s + (r.count ?? 0), 0);
  check("reports totals", repTotal === 0, `sees ${repTotal}`);

  // The other half: a filter that hides everything from everyone also fails.
  console.log("\nA must still see its own records:");
  const own = await json("/api/offers", { headers: { "x-api-key": a.key } });
  check("owner sees own offer", own.raw.includes(MARKER));
  const ownDash = await json("/api/dashboard", { headers: { "x-api-key": a.key } });
  check("owner dashboard non-zero", (ownDash.body?.stats?.total_offers ?? 0) > 0, `sees ${ownDash.body?.stats?.total_offers}`);

  console.log("");
  if (failures.length) {
    console.error(`TENANT ISOLATION FAILED: ${failures.length} check(s) — ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("tenant isolation: all checks passed");
}

main().catch((err) => {
  console.error("isolation test error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
