import type { ConditionGrade, ValuationAnswers } from "../data/catalog";
import { inferGradeFromAnswers } from "../data/catalog";
import type { AiScanResult, DetectedIssue, MediaFile, PhotoAngle } from "./tradeInTypes";
import { gradeFromIssues } from "./localVision/issues";

/**
 * Genius AI scan — checklist + multi-angle on-device computer vision.
 * Detects structured issues (crack, scratch, dent, …) per front/back/side photo.
 */
export async function runGeniusAiScan(opts: {
  valuation: ValuationAnswers;
  media: MediaFile[];
}): Promise<AiScanResult> {
  const usedMedia = opts.media.length > 0;
  const baseGrade = inferGradeFromAnswers(opts.valuation);

  let screenScore = scoreFromExterior(opts.valuation.exterior);
  let bodyScore = scoreFromExterior(opts.valuation.exterior);
  const notes: string[] = [];
  let vision: AiScanResult["vision"];
  let issues: DetectedIssue[] = [];
  let perAngle: AiScanResult["perAngle"];
  let anglesCovered: PhotoAngle[] = [];

  if (opts.valuation.powerOn === false) {
    screenScore = Math.min(screenScore, 35);
    bodyScore = Math.min(bodyScore, 40);
    notes.push("Checklist: device does not power on");
  }
  if (opts.valuation.liquidDamage) {
    bodyScore = Math.min(bodyScore, 45);
  }
  if (opts.valuation.fullyFunctional === false) {
    screenScore = Math.min(screenScore, 50);
  }

  if (usedMedia) {
    await new Promise((r) => setTimeout(r, 40));
    const { runLocalDeviceVision } = await import("./localVision");
    const report = await runLocalDeviceVision(opts.media);

    issues = report.issues;
    perAngle = report.perAngle;
    anglesCovered = report.anglesCovered;

    if (report.framesAnalyzed > 0) {
      if (report.poweredOffLikely) {
        const visionWeight = 0.2;
        const checklistWeight = 1 - visionWeight;
        screenScore = Math.round(
          screenScore * checklistWeight + Math.max(report.screenScore, 70) * visionWeight,
        );
        bodyScore = Math.round(bodyScore * checklistWeight + report.bodyScore * visionWeight);
        if (opts.valuation.powerOn === true) {
          notes.push(
            "Front photo looks powered off while checklist says it turns on — retake front with screen on",
          );
        }
      } else {
        const visionWeight = 0.5 + report.sharpness * 0.25;
        const checklistWeight = 1 - visionWeight;
        screenScore = Math.round(
          screenScore * checklistWeight + report.screenScore * visionWeight,
        );
        bodyScore = Math.round(bodyScore * checklistWeight + report.bodyScore * visionWeight);
      }

      vision = {
        method: "local-cv",
        framesAnalyzed: report.framesAnalyzed,
        images: report.images,
        videos: report.videos,
        crackDensity: report.crackDensity,
        scratchIndex: report.scratchIndex,
        discoloration: report.discoloration,
        sharpness: report.sharpness,
        edgePreviewUrl: report.edgePreviewUrl,
      };
      notes.push(...report.notes);
    } else {
      notes.push("Could not decode media locally — falling back to checklist grading");
      screenScore = clamp(screenScore - 3, 15, 99);
      bodyScore = clamp(bodyScore - 3, 15, 99);
    }
  } else {
    notes.push("No photo/video provided — grade based on your checklist answers only");
  }

  screenScore = clamp(screenScore, 12, 99);
  bodyScore = clamp(bodyScore, 12, 99);
  const avg = (screenScore + bodyScore) / 2;

  const issueHint = issues.length
    ? gradeFromIssues(issues, screenScore, bodyScore)
    : gradeFromScores(avg, opts.valuation, vision?.crackDensity ?? 0);
  const mediaHint = gradeFromScores(avg, opts.valuation, vision?.crackDensity ?? 0);
  const suggestedGrade = worseGrade(baseGrade, worseGrade(issueHint, mediaHint));

  if (opts.valuation.powerOn === false) {
    // already noted
  } else if (screenScore >= 85) notes.push("Display score looks strong after local analysis");
  else if (screenScore >= 60) notes.push("Screen band suggests wear, scratches, or minor cracks");
  else notes.push("Screen band suggests significant damage");

  if (bodyScore >= 85) notes.push("Body / housing score looks strong");
  else notes.push("Body band suggests scuffs, dents, or heavier cosmetic wear");

  const missingRequired = (["front", "back", "left", "right"] as PhotoAngle[]).filter(
    (a) => !anglesCovered.includes(a),
  );
  if (usedMedia && missingRequired.length) {
    notes.push(
      `Tip: add ${missingRequired.join(", ")} photos for a more exact condition grade`,
    );
  }

  if (opts.valuation.batteryHealth !== null) {
    notes.push(`Reported battery health: ${opts.valuation.batteryHealth}%`);
  }
  if (opts.valuation.activationLockFree === false) {
    notes.push("Activation / iCloud / FRP lock must be removed before payout");
  }
  notes.push("Final offer confirmed after Tech Genius inspection");

  const angleBoost = Math.min(12, anglesCovered.length * 3);
  const issueClarity = issues.length ? Math.min(6, issues.length * 1.5) : 4;
  const sharpnessBoost = vision ? vision.sharpness * 8 : 0;
  const frameBoost = vision ? Math.min(8, vision.framesAnalyzed) : 0;
  const confidence = usedMedia
    ? clamp(
        Math.round(68 + avg / 14 + sharpnessBoost + frameBoost + angleBoost + issueClarity),
        70,
        97,
      )
    : clamp(Math.round(58 + avg / 14), 52, 78);

  return {
    screenScore,
    bodyScore,
    suggestedGrade,
    notes,
    confidence,
    usedMedia,
    vision,
    issues,
    perAngle,
    anglesCovered,
  };
}

function scoreFromExterior(exterior: ValuationAnswers["exterior"]): number {
  switch (exterior) {
    case "none":
      return 94;
    case "minor":
      return 84;
    case "visible":
      return 72;
    case "heavy":
      return 55;
    case "cracks":
      return 42;
    default:
      return 70;
  }
}

function gradeFromScores(
  avg: number,
  v: ValuationAnswers,
  crackDensity: number,
): ConditionGrade {
  if (v.powerOn === false || v.liquidDamage) return "defective";
  if (crackDensity > 0.04 && avg < 55) return "fair";
  if (avg >= 90) return "flawless";
  if (avg >= 80) return "good";
  if (avg >= 68) return "average";
  if (avg >= 50) return "fair";
  return "defective";
}

const order: ConditionGrade[] = ["flawless", "good", "average", "fair", "defective"];

function worseGrade(a: ConditionGrade, b: ConditionGrade): ConditionGrade {
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
