import { randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";

/**
 * Make sure this deployment has real secrets, generating them once if it does
 * not.
 *
 * The server refuses to start in production when the master key, the cron
 * secret or the admin password are still the values that ship in the source —
 * which is right, because they are public. But "refuse to start" left the
 * whole site frozen on a five-day-old container while every push built
 * successfully and then exited, and the only trace was a line in a deploy log
 * nobody was watching. A correct guard with no path forward is still an outage.
 *
 * So rather than choosing between a known-public key and a dead service, the
 * deployment gets keys of its own: generated with the system CSPRNG on first
 * boot, stored in the database beside everything else that has to survive a
 * restart, and reused every boot after. Nothing here is ever a value an
 * attacker could look up in the repository.
 *
 * An environment variable always wins. Setting TG_ADMIN_PASSWORD is how the
 * owner takes the password back if the generated one scrolled past in a log,
 * and setting TG_API_KEY is how an integration keeps a key the shop chose.
 */

const KEYS = [
  {
    env: "TG_API_KEY",
    setting: "secret:api_key",
    label: "master API key",
    make: () => randomBytes(32).toString("hex"),
  },
  {
    env: "TG_CRON_SECRET",
    setting: "secret:cron_secret",
    label: "cron secret",
    make: () => randomBytes(32).toString("hex"),
  },
  {
    env: "TG_ADMIN_PASSWORD",
    setting: "secret:admin_password",
    label: "admin password",
    // Shorter and base64url so it can be read off a screen and typed; still
    // 144 bits, which is far past anything that gets guessed.
    make: () => randomBytes(18).toString("base64url"),
  },
] as const;

export interface EnsuredSecrets {
  /** Secrets that were created on this boot, by label. */
  generated: string[];
  /** The admin password, only when it was generated just now. */
  newAdminPassword: string | null;
}

export function ensureSecrets(db: Database): EnsuredSecrets {
  const read = db.prepare("SELECT value FROM settings WHERE key = ?");
  const write = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );

  const generated: string[] = [];
  let newAdminPassword: string | null = null;

  for (const k of KEYS) {
    // Given explicitly: that is the shop's choice and nothing is stored.
    if (process.env[k.env]) continue;

    const row = read.get(k.setting) as { value: string } | undefined;
    if (row?.value) {
      process.env[k.env] = row.value;
      continue;
    }

    const value = k.make();
    write.run(k.setting, value);
    process.env[k.env] = value;
    generated.push(k.label);
    if (k.env === "TG_ADMIN_PASSWORD") newAdminPassword = value;
  }

  return { generated, newAdminPassword };
}

/**
 * Say what happened, loudly enough to be found later.
 *
 * The admin password is printed exactly once — the boot that created it —
 * because it is the only moment it is recoverable. It is not printed again on
 * later boots, since a password sitting in every deploy log is its own problem.
 */
export function reportSecrets(s: EnsuredSecrets): void {
  if (!s.generated.length) return;
  console.log(`\n🔑 Generated ${s.generated.join(", ")} for this deployment and saved them to the database.`);
  if (s.newAdminPassword) {
    console.log("   Admin password (shown once — copy it now):");
    console.log(`       ${s.newAdminPassword}`);
    console.log("   Set TG_ADMIN_PASSWORD in the environment to choose your own and override this.");
  }
  console.log("");
}
