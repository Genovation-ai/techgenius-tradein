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

  // Cracks: front screen is primary; body angles need stronger signal
  const crackThreshold = isFront ? 0.022 : 0.035;
  if (
    dominant !== "powered_off" &&
    dominant !== "black_screen" &&
    dominant !== "too_dark" &&
    crackDensity >= crackThreshold
  ) {
    const sev = severityFrom(
      crackDensity,
      crackThreshold,
      isFront ? 0.035 : 0.05,
      isFront ? 0.055 : 0.08,
    );
    const conf = Math.min(96, 55 + crackDensity * 900);
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

  if (discoloration >= 0.42 && dominant !== "powered_off" && dominant !== "glare") {
    const type: IssueType = isFront && discoloration > 0.55 ? "dead_pixels" : "discoloration";
    push(
      type,
      severityFrom(discoloration, 0.42, 0.52, 0.65),
      Math.min(90, 48 + discoloration * 70),
    );
  }

  // Dent / warp: asymmetric strong edges on body angles
  if (isBody && (edgeAsymmetry ?? 0) > 0.28 && scratchIndex > 0.18) {
    push(
      "dent",
      severityFrom(edgeAsymmetry ?? 0, 0.28, 0.4, 0.55),
      Math.min(88, 45 + (edgeAsymmetry ?? 0) * 80),
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
