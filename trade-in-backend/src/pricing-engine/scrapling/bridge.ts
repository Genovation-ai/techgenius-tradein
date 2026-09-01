import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderAdapter, ScraperResult, ToScrape } from "../types.js";
import { sanitizeScrapedPrice } from "../validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(__dirname, "../../../scripts/scrapling_worker.py");

export function createScraplingAdapter(opts: { name: string }): ProviderAdapter {
  return {
    name: opts.name,
    engine: "scrapling",
    async scrape(devices: ToScrape[], scrapeOpts): Promise<ScraperResult> {
      const timeoutMs = scrapeOpts?.timeoutMs ?? 120_000;
      const started = Date.now();

      return new Promise((resolve) => {
        const child = spawn("python3", [WORKER], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        const killTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, timeoutMs);

        child.stdout.on("data", (b) => {
          stdout += String(b);
        });
        child.stderr.on("data", (b) => {
          stderr += String(b);
        });

        child.on("close", () => {
          clearTimeout(killTimer);
          try {
            const parsed = JSON.parse(stdout || "{}") as ScraperResult & {
              rows: unknown[];
            };
            const rows = (parsed.rows || [])
              .map((r) => sanitizeScrapedPrice(r as never))
              .filter((r): r is NonNullable<typeof r> => !!r);
            resolve({
              provider: opts.name,
              engine: "scrapling",
              rows,
              errors: [
                ...(parsed.errors || []),
                ...(stderr.trim() ? [`scrapling stderr: ${stderr.trim().slice(0, 500)}`] : []),
              ],
              durationMs: Date.now() - started,
              targeted: parsed.targeted ?? devices.filter((d) => d.url).length,
              discovered: rows.length,
            });
          } catch (e) {
            resolve({
              provider: opts.name,
              engine: "scrapling",
              rows: [],
              errors: [
                `scrapling bridge parse error: ${e instanceof Error ? e.message : String(e)}`,
                stderr.slice(0, 500),
              ],
              durationMs: Date.now() - started,
              targeted: devices.filter((d) => d.url).length,
              discovered: 0,
            });
          }
        });

        child.stdin.write(
          JSON.stringify({
            provider: opts.name,
            devices,
            timeoutSec: Math.max(10, Math.floor(timeoutMs / 1000) - 5),
          }),
        );
        child.stdin.end();
      });
    },
  };
}
