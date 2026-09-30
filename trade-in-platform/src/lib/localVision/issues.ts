import type {
  AngleVisionSummary,
  DetectedIssue,
  FrameAnalysis,
  IssueSeverity,
  IssueType,
  PhotoAngle,
} from "./types";

const ISSUE_LABELS: Record<IssueType, string> = {
  crack: "Crack / shattered glass",
  scratch: "Scratches / scuffs",
  dent: "Dent or housing warp",
  discoloration: "Discoloration / stain",
  dead_pixels: "Dead pixels / display blotch",
  glare: "Glare — retake recommended",
  powered_off: "Screen appears powered off",
  blurry: "Blurry capture",
  no_device: "Device hard to find in frame",
};

function severityFrom(score: number, low: number, med: number, high: number): IssueSeverity {
  if (score >= high) return "high";
  if (score >= med) return "medium";
  if (score >= low) return "low";
  return "low";
}

/**
 * Map classic CV metrics + angle role → structured trade-in issues.
 * Front heavily weights screen/crack; sides/back weight body/housing.
 */
export function detectIssuesForAngle(
  angle: PhotoAngle,
  frames: FrameAnalysis[],
): DetectedIssue[] {
  if (!frames.length) return [];

  const avg = (key: keyof FrameAnalysis) =>
    frames.reduce((s, f) => s + (Number(f[key]) || 0), 0) / frames.length;

  const crackDensity = avg("crackDensity");
  const scratchIndex = avg("scratchIndex");
  const discoloration = avg("discoloration");
  const sharpness = avg("sharpness");
  const edgeAsymmetry = avg("edgeAsymmetry");

  const scenarioCounts = new Map<string, number>();
  for (const f of frames) {
    scenarioCounts.set(f.scenario, (scenarioCounts.get(f.scenario) ?? 0) + 1);
  }
  let dominant = frames[0].scenario;
  let best = 0;
  for (const [k, v] of scenarioCounts) {
    if (v > best) {
      best = v;
      dominant = k as FrameAnalysis["scenario"];
    }
  }

  const issues: DetectedIssue[] = [];
  const push = (
    type: IssueType,
    severity: IssueSeverity,
    confidence: number,
    extra?: string,
  ) => {
    issues.push({
      id: `${angle}-${type}-${issues.length}`,
      type,
      severity,
      angle,
      confidence: Math.round(Math.max(0, Math.min(99, confidence))),
      label: extra ? `${ISSUE_LABELS[type]} (${extra})` : ISSUE_LABELS[type],
    });
  };

  const isFront = angle === "front";
  const isBody = angle === "back" || angle === "left" || angle === "right";

  if (dominant === "powered_off" || dominant === "black_screen" || dominant === "too_dark") {
    if (isFront) {
      push("powered_off", "medium", 82, "turn screen on for display check");
    }
  } else if (dominant === "glare") {
    push("glare", "medium", 75);
  } else if (dominant === "blurry" || sharpness < 0.16) {
    push("blurry", "low", 70);
  } else if (dominant === "no_device") {
    push("no_device", "medium", 68);
  }

  /**
   * Cracks: front screen is primary; body angles need stronger signal.
   *
   * Calibrated against 120 photographs of undamaged devices. Their edge
   * density runs from 0.007 to 0.146 (median 0.048) — a phone's own outline,
   * bezel, buttons and reflections are all strong edges, and none of them are
   * damage. The old 0.022 sat below the median of that clean population and
   * flagged 113 of the 120 as cracked, so a customer who photographed a mint
   * handset was told its glass was shattered and watched a flawless grade fall
   * to fair. Shattered glass measures around 0.26, well clear of the clean
   * ceiling, so the threshold now sits between the two populations.
   *
   * Erring high is the right direction here. A missed crack is caught when the
   * device is inspected before anyone is paid, and the checklist asks about
   * exterior condition independently; a false accusation is seen by the
   * customer immediately and costs the trade.
   */
  const crackThreshold = isFront ? 0.18 : 0.22;
  if (
    dominant !== "powered_off" &&
    dominant !== "black_screen" &&
    dominant !== "too_dark" &&
    crackDensity >= crackThreshold
  ) {
    const sev = severityFrom(
      crackDensity,
      crackThreshold,
      isFront ? 0.24 : 0.28,
      isFront ? 0.32 : 0.36,
    );
    // Confidence scaled for the same range; at 900x every reading above the
    // threshold pinned to the 96 ceiling and every crack looked certain.
    const conf = Math.min(96, 45 + crackDensity * 150);
    push(
      "crack",
      sev,
      conf,
      isFront ? "display / glass" : "housing or glass edge",
    );
  }

  if (scratchIndex >= 0.22 && dominant !== "powered_off") {
    const sev = severityFrom(scratchIndex, 0.22, 0.32, 0.45);
    push(
      "scratch",
      sev,
      Math.min(92, 50 + scratchIndex * 90),
      isBody ? "body / back" : "surface",
    );
  }

  /**
   * Discoloration is brightness spread across the frame, and on the same 120
   * clean photos it saturates: the median reading is 1.0 and the minimum is
   * 0.36, because a dark device on a light surface is by definition a
   * high-variance image. A signal that reads maximum for an undamaged phone
   * carries no information about damage, and at the old 0.42 bar it announced
   * "dead pixels" on essentially every upload.
   *
   * Kept only where it can mean something: a screen that is lit, so the spread
   * is coming from what the display is showing rather than from the desk around
   * it, and only alongside a real second signal. Anything less and this claim
   * is not worth making to a customer.
   */
  const litScreen = dominant === "lit_screen" || dominant === "cracked_lit";
  if (
    discoloration >= 0.9 &&
    litScreen &&
    scratchIndex >= 0.15 &&
    dominant !== "powered_off" &&
    dominant !== "glare"
  ) {
    const type: IssueType = isFront ? "dead_pixels" : "discoloration";
    push(type, severityFrom(discoloration, 0.9, 0.95, 0.98), Math.min(75, 40 + discoloration * 30));
  }

  /*
   * Dent / warp: one side of the housing carrying more strong edge than the
   * other.
   *
   * This asked for an asymmetry above 0.28 and a scratch index above 0.18.
   * Measured across frames with dents of known size, asymmetry runs from 0.030
   * to 0.054 and the scratch index never passes 0.06 — so the first test was
   * roughly five times out of range and the second could not be satisfied at
   * all. Both had to hold, so the rule had never once fired, on any photograph,
   * since it was written. It reads like thresholds left behind when the metric
   * underneath them was rescaled.
   *
   * The thresholds below are where dents separate from undamaged housings in
   * that corpus. Glare and blur are excluded rather than merely out-scored:
   * both land at asymmetries that reach into the dent range, and reporting a
   * reflection as a dent takes money off a customer for damage that is not
   * there.
   */
  const dentAsym = edgeAsymmetry ?? 0;
  if (isBody && dentAsym > 0.03 && dominant !== "glare" && dominant !== "blurry") {
    push(
      "dent",
      severityFrom(dentAsym, 0.03, 0.04, 0.05),
      Math.min(88, 40 + dentAsym * 600),
      angle,
    );
  }

  return issues;
}

export function summarizeAngle(
  angle: PhotoAngle,
  frames: FrameAnalysis[],
  screenScore: number,
  bodyScore: number,
  agg: {
    crackDensity: number;
    scratchIndex: number;
    discoloration: number;
    sharpness: number;
    dominantScenario: FrameAnalysis["scenario"];
    poweredOffLikely: boolean;
  },
): AngleVisionSummary {
  return {
    angle,
    framesAnalyzed: frames.length,
    screenScore,
    bodyScore,
    crackDensity: agg.crackDensity,
    scratchIndex: agg.scratchIndex,
    discoloration: agg.discoloration,
    sharpness: agg.sharpness,
    scenario: agg.dominantScenario,
    poweredOffLikely: agg.poweredOffLikely,
    issues: detectIssuesForAngle(angle, frames),
  };
}

/** Map structured issues → Tech Genius condition band (before checklist merge). */
export function gradeFromIssues(
  issues: DetectedIssue[],
  screenScore: number,
  bodyScore: number,
): "flawless" | "good" | "average" | "fair" | "defective" {
  const has = (type: IssueType, min: IssueSeverity = "low") => {
    const order = { low: 0, medium: 1, high: 2 };
    return issues.some((i) => i.type === type && order[i.severity] >= order[min]);
  };

  const frontCrackHigh = issues.some(
    (i) => i.type === "crack" && i.angle === "front" && i.severity === "high",
  );
  const anyHighCrack = has("crack", "high");
  const anyMedCrack = has("crack", "medium");
  const heavyBody =
    has("dent", "high") ||
    (has("scratch", "high") && has("discoloration", "medium"));

  if (frontCrackHigh && screenScore < 40) return "defective";
  if (anyHighCrack || (anyMedCrack && screenScore < 55)) return "fair";
  if (heavyBody || has("scratch", "high") || has("discoloration", "high")) return "average";
  if (has("scratch", "medium") || has("dent", "medium") || has("discoloration", "medium")) {
    return "good";
  }

  const avg = (screenScore + bodyScore) / 2;
  if (avg >= 90 && !issues.some((i) => i.type === "crack" || i.type === "dent")) return "flawless";
  if (avg >= 82) return "good";
  if (avg >= 68) return "average";
  if (avg >= 50) return "fair";
  return "defective";
}

export const REQUIRED_ANGLES: PhotoAngle[] = ["front", "back", "left", "right"];

export const ANGLE_META: Record<
  PhotoAngle,
  { title: string; hint: string; required: boolean }
> = {
  front: {
    title: "Front (screen on)",
    hint: "Power on, fill the frame, avoid glare",
    required: true,
  },
  back: {
    title: "Back",
    hint: "Show housing, camera island, and any scuffs",
    required: true,
  },
  left: {
    title: "Left side",
    hint: "Buttons, ports edge, frame dents",
    required: true,
  },
  right: {
    title: "Right side",
    hint: "Opposite frame / buttons",
    required: true,
  },
  extra: {
    title: "Extra",
    hint: "Close-up of damage or walk-around clip",
    required: false,
  },
};
