import {
  localContrastIndex,
  laplacianVariance,
  meanStd,
  regionStats,
  sobelMagnitude,
  toGray,
} from "./filters";
import { imageDataToEdgePreview } from "./imageIO";
import type { FrameAnalysis, FrameScenario } from "./types";

/**
 * Classic CV frame analysis with scenario detection.
 * Critical: powered-off / black screens must NOT be scored as cracked glass.
 */
export function analyzeFrame(image: ImageData, withPreview = false): {
  analysis: FrameAnalysis;
  edgePreviewUrl?: string;
} {
  const { width: w, height: h } = image;
  const gray = toGray(image);
  const mag = sobelMagnitude(gray, w, h);
  const { mean: brightnessRaw, std: brightStd } = meanStd(gray);
  const brightness = brightnessRaw / 255;

  /*
   * How much of the frame is blown out, as distinct from how bright it is on
   * average.
   *
   * Glare was detected by asking whether the whole frame was brighter than
   * 0.88, which is a photograph of a lightbulb, not a photograph of a phone
   * with a reflection on it. Measured against frames with a known reflection
   * burned into them, average brightness came out at 0.498 against 0.501 for
   * the same phone clean: the reflection moves a patch to white and leaves the
   * rest alone, so the mean says nothing and the test never fired. Every glare
   * frame in the corpus went unreported.
   *
   * The fraction of near-saturated pixels does see it, because that is what a
   * reflection is — a region with no detail left in it.
   */
  let blown = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] >= 244) blown++;
  }
  const blownFraction = gray.length ? blown / gray.length : 0;

  // Dual thresholds: dark frames use a higher bar so camera noise ≠ cracks
  const darkFrame = brightness < 0.18;
  const edgeThresh = darkFrame ? 140 : 90;
  let strong = 0;
  let veryStrong = 0;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] > edgeThresh) strong++;
    if (mag[i] > 170) veryStrong++;
  }
  let crackDensity = strong / mag.length;
  const extremeEdgeRatio = veryStrong / mag.length;

  /*
   * Fracture shape is deliberately not measured here yet.
   *
   * edgeElongation in filters.ts finds long thin connected edge, which is what
   * a crack is and what busy texture is not. It is not called, because it
   * could not be validated: the only labelled frames available are built on
   * product renders, and those renders display swirling line wallpapers that
   * are themselves long thin curves. Measured against them the feature scored
   * 0.078 on undamaged phones and 0.012 on badly cracked ones — it was reading
   * the wallpaper, in the wrong direction.
   *
   * Running it anyway would cost a connected-component pass over every frame
   * on a customer's phone in exchange for a number nobody has shown to mean
   * anything. It waits for photographs of real cracked devices, which the
   * shop generates every week and which nothing currently keeps.
   */

  const scratchIndex = clamp01(localContrastIndex(gray, w, h, 2) * 4.5);
  const discoloration = clamp01(brightStd / 55);
  const lapVar = laplacianVariance(gray, w, h);
  const sharpness = clamp01(lapVar / 450);

  const cx0 = Math.floor(w * 0.25);
  const cy0 = Math.floor(h * 0.2);
  const cx1 = Math.floor(w * 0.75);
  const cy1 = Math.floor(h * 0.8);
  const center = regionStats(gray, mag, w, h, cx0, cy0, cx1, cy1);
  const border = regionStats(gray, mag, w, h, 0, 0, w, Math.floor(h * 0.12));
  const leftBand = regionStats(gray, mag, w, h, 0, Math.floor(h * 0.15), Math.floor(w * 0.22), Math.floor(h * 0.85));
  const rightBand = regionStats(
    gray,
    mag,
    w,
    h,
    Math.floor(w * 0.78),
    Math.floor(h * 0.15),
    w,
    Math.floor(h * 0.85),
  );
  const edgeAsymmetry = clamp01(
    Math.abs(leftBand.strongRatio - rightBand.strongRatio) * 2.4 +
      Math.abs(leftBand.meanBright - rightBand.meanBright) / 90,
  );
  const screenLikelihood = clamp01(
    (center.meanBright - border.meanBright) / 40 + 0.35 + (1 - center.strongRatio) * 0.2,
  );

  const scenario = classifyScenario({
    brightness,
    brightStd,
    blownFraction,
    crackDensity,
    extremeEdgeRatio,
    sharpness,
    scratchIndex,
    centerMean: center.meanBright / 255,
    centerStrong: center.strongRatio,
  });

  // Powered-off / black / empty: suppress false crack signal
  if (
    scenario === "powered_off" ||
    scenario === "black_screen" ||
    scenario === "no_device" ||
    scenario === "too_dark"
  ) {
    crackDensity *= 0.15;
  }
  // Blurry / glare: cracks unreliable
  if (scenario === "blurry" || scenario === "glare") {
    crackDensity *= 0.45;
  }

  const analysis: FrameAnalysis = {
    width: w,
    height: h,
    blownFraction,
    crackDensity,
    scratchIndex,
    discoloration,
    sharpness,
    brightness,
    screenLikelihood,
    scenario,
    brightStd: brightStd / 255,
    edgeAsymmetry,
  };

  const edgePreviewUrl = withPreview ? imageDataToEdgePreview(gray, w, h, mag) : undefined;
  return { analysis, edgePreviewUrl };
}

function classifyScenario(s: {
  brightness: number;
  brightStd: number;
  blownFraction: number;
  crackDensity: number;
  extremeEdgeRatio: number;
  sharpness: number;
  scratchIndex: number;
  centerMean: number;
  centerStrong: number;
}): FrameScenario {
  // Nearly uniform black — phone off or black wallpaper / screen-off photo
  if (s.brightness < 0.12 && s.brightStd < 22) return "powered_off";
  if (s.centerMean < 0.1 && s.brightStd < 28 && s.crackDensity < 0.06) return "black_screen";
  if (s.brightness < 0.08) return "too_dark";

  // Blown-out glare
  /*
   * A reflection is a patch with no detail left in it. Judge it by how much of
   * the frame is blown out, together with a lift in the average, rather than
   * by the average alone. The old test — whole frame above 0.88 — described a
   * photograph of a light, not of a phone with a reflection on it, and
   * reported glare on none of the frames that had one.
   *
   * These two numbers are where a corpus of known reflections separates from
   * the same phones clean: 0.034 blown and 0.61 bright against 0.015 and 0.50.
   * The margin is real but not wide, and it was measured on product renders
   * rather than on photographs taken in a shop. Re-measure it against real
   * customer photographs before trusting it to refuse one.
   */
  if (s.blownFraction > 0.020 && s.brightness > 0.53) return "glare";
  if (s.brightness > 0.88 && s.brightStd < 30) return "glare";

  // Soft / motion blur video frame
  if (s.sharpness < 0.14) return "blurry";

  // Almost no structure — empty desk / wall
  if (s.crackDensity < 0.004 && s.scratchIndex < 0.08 && s.sharpness < 0.2) return "no_device";

  // Lit screen with strong linear shatter cues
  if (
    s.brightness >= 0.2 &&
    s.crackDensity > 0.04 &&
    s.extremeEdgeRatio > 0.012 &&
    s.sharpness > 0.18
  ) {
    return "cracked_lit";
  }

  // Screen content / UI visible (edges from icons, not necessarily cracks)
  if (s.brightness >= 0.22 && s.brightStd > 35 && s.centerMean > 0.25) return "lit_screen";

  return "normal";
}

export function aggregateFrameScores(frames: FrameAnalysis[]): {
  crackDensity: number;
  scratchIndex: number;
  discoloration: number;
  sharpness: number;
  brightness: number;
  screenLikelihood: number;
  screenScore: number;
  bodyScore: number;
  notes: string[];
  dominantScenario: FrameScenario;
  poweredOffLikely: boolean;
} {
  if (!frames.length) {
    return {
      crackDensity: 0,
      scratchIndex: 0,
      discoloration: 0,
      sharpness: 0,
      brightness: 0,
      screenLikelihood: 0,
      screenScore: 70,
      bodyScore: 70,
      notes: ["No frames available for local vision."],
      dominantScenario: "no_device",
      poweredOffLikely: false,
    };
  }

  const avg = (key: keyof FrameAnalysis) =>
    frames.reduce((s, f) => s + (Number(f[key]) || 0), 0) / frames.length;

  const crackDensity = avg("crackDensity");
  const scratchIndex = avg("scratchIndex");
  const discoloration = avg("discoloration");
  const sharpness = avg("sharpness");
  const brightness = avg("brightness");
  const screenLikelihood = avg("screenLikelihood");

  const scenarioCounts = new Map<FrameScenario, number>();
  for (const f of frames) {
    scenarioCounts.set(f.scenario, (scenarioCounts.get(f.scenario) ?? 0) + 1);
  }
  let dominantScenario: FrameScenario = "normal";
  let best = 0;
  for (const [k, v] of scenarioCounts) {
    if (v > best) {
      best = v;
      dominantScenario = k;
    }
  }

  const poweredOffLikely =
    dominantScenario === "powered_off" ||
    dominantScenario === "black_screen" ||
    dominantScenario === "too_dark" ||
    (brightness < 0.15 && crackDensity < 0.02);

  // Prefer lit / cracked frames for cosmetic crack scoring when mixed with dark frames
  const litFrames = frames.filter(
    (f) =>
      f.scenario === "lit_screen" ||
      f.scenario === "cracked_lit" ||
      f.scenario === "normal" ||
      (f.brightness >= 0.22 && f.scenario !== "powered_off" && f.scenario !== "black_screen"),
  );
  const crackSource = litFrames.length ? litFrames : frames;
  const crackForScore =
    crackSource.reduce((s, f) => s + f.crackDensity, 0) / crackSource.length;

  /**
   * Edge density a perfectly good device produces on its own.
   *
   * Measured over 120 photographs of undamaged handsets: median 0.048, ceiling
   * 0.146. Those edges are the device outline, the bezel, the buttons and the
   * reflections — none of them damage. Scoring the raw figure charged a mint
   * phone about 25 points before anything was wrong with it, so only the excess
   * over the clean population is penalised now, and harder, since a reading
   * above it is genuine.
   */
  const CLEAN_EDGE_BASELINE = 0.15;
  const crackExcess = Math.max(0, crackForScore - CLEAN_EDGE_BASELINE);

  let screenScore = 96;
  if (poweredOffLikely) {
    // Off screen ≠ cracked — mild uncertainty only
    screenScore -= 4;
    screenScore -= scratchIndex * 20;
  } else {
    screenScore -= crackExcess * 700;
    screenScore -= scratchIndex * 55;
    // discoloration is deliberately absent: on the same 120 clean photos its
    // median reading is 1.0 and its minimum 0.36, because a dark device on a
    // light surface is a high-variance image by construction. It cost every
    // upload a flat 35 points while saying nothing about the device. Where the
    // spread genuinely means something — a lit screen, corroborated — it is
    // still raised as an issue in issues.ts.
    if (sharpness < 0.25) screenScore -= 8;
    if (brightness < 0.12 || brightness > 0.92) screenScore -= 6;
  }

  let bodyScore = 94;
  bodyScore -= scratchIndex * 90;
  if (!poweredOffLikely) bodyScore -= crackExcess * 260;
  else bodyScore -= scratchIndex * 15;
  if (screenLikelihood < 0.35) bodyScore -= scratchIndex * 25;

  screenScore = clamp(Math.round(screenScore), 12, 99);
  bodyScore = clamp(Math.round(bodyScore), 12, 99);

  const notes: string[] = [];
  notes.push(
    `On-device CV analyzed ${frames.length} frame${frames.length === 1 ? "" : "s"} (scenario: ${dominantScenario.replace(/_/g, " ")})`,
  );

  if (poweredOffLikely) {
    notes.push(
      "Screen looks powered off / black — not treated as cracked glass. Turn the device on for a display check, or confirm power status in the checklist.",
    );
  } else if (dominantScenario === "cracked_lit" || crackForScore > 0.045) {
    notes.push("High edge density on a lit surface — possible cracks or shattered glass");
  } else if (crackForScore > 0.022) {
    notes.push("Elevated edge patterns — fine cracks or heavy scratch lines possible");
  } else {
    notes.push("Low crack-like edge density on visible surfaces");
  }

  if (dominantScenario === "blurry") {
    notes.push("Video/photo is soft — retake steadier footage for higher confidence");
  }
  if (dominantScenario === "glare") {
    notes.push("Strong glare detected — tilt away from lights and retry");
  }
  if (dominantScenario === "no_device") {
    notes.push("Hard to find a device in frame — fill the shot with the phone screen/body");
  }

  if (scratchIndex > 0.35) notes.push("Texture analysis suggests scuffs or micro-scratches");
  else if (scratchIndex > 0.22) notes.push("Light surface texture / minor wear detected");
  else if (!poweredOffLikely) notes.push("Surface texture looks relatively smooth");

  if (discoloration > 0.45 && !poweredOffLikely) {
    notes.push("Uneven color patches — stains, burn-in, or lighting artifacts");
  }
  if (sharpness < 0.2 && !poweredOffLikely) {
    notes.push("Image is soft/blurry — retake with steadier focus for higher confidence");
  }
  if (screenLikelihood > 0.55 && !poweredOffLikely) {
    notes.push("Center region looks screen/glass-like — weighted toward display grade");
  } else if (!poweredOffLikely) {
    notes.push("Framing looks more like housing/back — weighted toward body grade");
  }

  return {
    crackDensity: crackForScore,
    scratchIndex,
    discoloration,
    sharpness,
    brightness,
    screenLikelihood,
    screenScore,
    bodyScore,
    notes,
    dominantScenario,
    poweredOffLikely,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
