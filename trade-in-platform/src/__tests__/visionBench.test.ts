import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFrame } from "../lib/localVision/analyze";
import { detectIssuesForAngle } from "../lib/localVision/issues";
import type { FrameAnalysis, IssueType, PhotoAngle } from "../lib/localVision/types";

/**
 * What the scanner actually sees.
 *
 * The other tests hand written issue objects to the grading function and check
 * that a high-severity crack maps to a low grade. That mapping was never in
 * doubt. Nothing asked whether the vision finds a crack in a photograph of a
 * cracked phone, or reports one in a photograph of an undamaged phone — and
 * the second is the expensive failure, because it grades an honest customer's
 * clean device down and the shop only learns when the device arrives fine.
 *
 * Run scripts/vision_corpus.py first; it builds frames whose damage is known
 * because it drew it. The corpus is not committed, so the suite skips rather
 * than fails when it is absent.
 */

const CORPUS = path.resolve(import.meta.dirname, "../../.vision-corpus");

interface Entry {
  file: string;
  width: number;
  height: number;
  device: string;
  damage: string;
  severity: string;
}

function loadCorpus(): Entry[] | null {
  const mf = path.join(CORPUS, "manifest.json");
  if (!existsSync(mf)) return null;
  return JSON.parse(readFileSync(mf, "utf8")) as Entry[];
}

function frameOf(e: Entry): ImageData {
  const buf = readFileSync(path.join(CORPUS, e.file));
  return new ImageData(new Uint8ClampedArray(buf), e.width, e.height);
}

/** Which detector output counts as "found it" for each kind of damage. */
const EXPECTED: Record<string, IssueType[]> = {
  crack: ["crack"],
  scratch: ["scratch"],
  dent: ["dent"],
  glare: ["glare"],
  blurry: ["blurry"],
  dark: ["powered_off", "no_device"],
};

/** Body damage is photographed from the back or side, screen damage from the front. */
function angleFor(damage: string): PhotoAngle {
  return damage === "dent" ? "back" : "front";
}

function pct(n: number, d: number) {
  return d === 0 ? "  n/a" : `${((n / d) * 100).toFixed(0).padStart(4)}%`;
}

describe("device scanner — measured against labelled frames", () => {
  const corpus = loadCorpus();

  it("reports detection and false-positive rates", { timeout: 120_000 }, () => {
    if (!corpus) {
      console.log("\n  no corpus — run: python3 scripts/vision_corpus.py\n");
      return;
    }

    // damage -> severity -> [hits, total]
    const hits = new Map<string, Map<string, [number, number]>>();
    // what the detector says about undamaged phones
    const falsePositives = new Map<IssueType, number>();
    let pristine = 0;

    for (const e of corpus) {
      const { analysis } = analyzeFrame(frameOf(e));
      const angle = angleFor(e.damage);
      const issues = detectIssuesForAngle(angle, [analysis as FrameAnalysis]);
      const types = new Set(issues.map((i) => i.type));

      if (e.damage === "none") {
        pristine++;
        for (const t of types) {
          // glare and blur on a clean render are capture complaints, not damage
          if (t === "glare" || t === "blurry") continue;
          falsePositives.set(t, (falsePositives.get(t) ?? 0) + 1);
        }
        continue;
      }

      const want = EXPECTED[e.damage] ?? [];
      const found = want.some((w) => types.has(w));
      if (!hits.has(e.damage)) hits.set(e.damage, new Map());
      const bySev = hits.get(e.damage)!;
      const [h, t] = bySev.get(e.severity) ?? [0, 0];
      bySev.set(e.severity, [h + (found ? 1 : 0), t + 1]);
    }

    const out: string[] = [];
    const say = (l: string) => { out.push(l); console.log(l); };
    say("\n  DETECTION RATE (found the damage that is there)");
    say("    damage      low    med   high");
    for (const [damage, bySev] of [...hits].sort()) {
      const cells = ["low", "medium", "high"]
        .map((s) => {
          const [h, t] = bySev.get(s) ?? [0, 0];
          return pct(h, t);
        })
        .join("  ");
      say(`    ${damage.padEnd(10)}${cells}`);
    }

    say(`\n  FALSE POSITIVES on ${pristine} undamaged phones`);
    if (falsePositives.size === 0) {
      say("    none");
    } else {
      for (const [t, n] of [...falsePositives].sort((a, b) => b[1] - a[1])) {
        say(`    ${t.padEnd(14)} ${pct(n, pristine)}  (${n}/${pristine})`);
      }
    }
    say("");
    writeFileSync(path.join(CORPUS, "report.txt"), out.join("\n"));

    expect(corpus.length).toBeGreaterThan(0);
  });
});
