import type { MediaFile } from "../tradeInTypes";
import { analyzeFrame, aggregateFrameScores } from "./analyze";
import { extractVideoFrames, loadImageData } from "./imageIO";
import { detectIssuesForAngle, summarizeAngle } from "./issues";
import type {
  AngleVisionSummary,
  DetectedIssue,
  FrameAnalysis,
  LocalVisionReport,
  PhotoAngle,
} from "./types";

export type {
  LocalVisionReport,
  FrameAnalysis,
  FrameScenario,
  PhotoAngle,
  DetectedIssue,
  AngleVisionSummary,
} from "./types";
export { gradeFromIssues, REQUIRED_ANGLES, ANGLE_META, detectIssuesForAngle } from "./issues";

/**
 * Fully local device-condition vision with multi-angle issue detection.
 * Uses Canvas + classic CV (Sobel edges, texture, Laplacian sharpness).
 */
export async function runLocalDeviceVision(media: MediaFile[]): Promise<LocalVisionReport> {
  const framesByAngle = new Map<PhotoAngle, FrameAnalysis[]>();
  const unlabeled: FrameAnalysis[] = [];
  let edgePreviewUrl: string | undefined;
  let images = 0;
  let videos = 0;

  const pushFrame = (angle: PhotoAngle | undefined, analysis: FrameAnalysis) => {
    if (angle) {
      if (!framesByAngle.has(angle)) framesByAngle.set(angle, []);
      framesByAngle.get(angle)!.push(analysis);
    } else {
      unlabeled.push(analysis);
    }
  };

  for (const item of media) {
    try {
      if (item.kind === "image") {
        images++;
        const data = await loadImageData(item.previewUrl);
        const { analysis, edgePreviewUrl: preview } = analyzeFrame(data, !edgePreviewUrl);
        pushFrame(item.angle, analysis);
        if (preview) edgePreviewUrl = preview;
      } else {
        videos++;
        const videoFrames = await extractVideoFrames(item.previewUrl, 6);
        for (let i = 0; i < videoFrames.length; i++) {
          const { analysis, edgePreviewUrl: preview } = analyzeFrame(
            videoFrames[i],
            !edgePreviewUrl && i === Math.floor(videoFrames.length / 2),
          );
          pushFrame(item.angle, analysis);
          if (preview) edgePreviewUrl = preview;
        }
      }
    } catch (err) {
      console.warn("[local-vision] skipped media", item.name, err);
    }
  }

  const allFrames = [...unlabeled, ...[...framesByAngle.values()].flat()];
  const agg = aggregateFrameScores(allFrames);

  const perAngle: AngleVisionSummary[] = [];
  const issues: DetectedIssue[] = [];

  if (framesByAngle.size) {
    for (const [angle, frames] of framesByAngle) {
      const localAgg = aggregateFrameScores(frames);
      // Front drives screen; body angles drive body
      let screenScore = localAgg.screenScore;
      let bodyScore = localAgg.bodyScore;
      if (angle === "front") {
        bodyScore = Math.round(bodyScore * 0.35 + localAgg.screenScore * 0.15 + 50);
      } else if (angle === "back" || angle === "left" || angle === "right") {
        screenScore = Math.round(screenScore * 0.25 + 70);
      }
      const summary = summarizeAngle(angle, frames, screenScore, bodyScore, localAgg);
      perAngle.push(summary);
      issues.push(...summary.issues);
    }

    // Recompute overall scores: front screen + body angles
    const front = perAngle.find((p) => p.angle === "front");
    const bodyAngles = perAngle.filter((p) => p.angle !== "front");
    if (front) agg.screenScore = front.screenScore;
    if (bodyAngles.length) {
      agg.bodyScore = Math.round(
        bodyAngles.reduce((s, p) => s + p.bodyScore, 0) / bodyAngles.length,
      );
    }
    // Prefer lit front crack signal
    if (front && !front.poweredOffLikely) {
      agg.crackDensity = Math.max(agg.crackDensity, front.crackDensity);
    }
  } else if (allFrames.length) {
    // Untagged media — still emit issues under "extra"
    const fallbackIssues = detectIssuesForAngle("extra", allFrames);
    issues.push(...fallbackIssues);
    perAngle.push(
      summarizeAngle("extra", allFrames, agg.screenScore, agg.bodyScore, {
        crackDensity: agg.crackDensity,
        scratchIndex: agg.scratchIndex,
        discoloration: agg.discoloration,
        sharpness: agg.sharpness,
        dominantScenario: agg.dominantScenario,
        poweredOffLikely: agg.poweredOffLikely,
      }),
    );
  }

  // Deduplicate issue types per angle keeping highest severity
  const severityRank = { low: 1, medium: 2, high: 3 };
  const deduped: DetectedIssue[] = [];
  const seen = new Map<string, DetectedIssue>();
  for (const issue of issues) {
    const key = `${issue.angle}:${issue.type}`;
    const prev = seen.get(key);
    if (!prev || severityRank[issue.severity] > severityRank[prev.severity]) {
      seen.set(key, issue);
    }
  }
  deduped.push(...seen.values());

  const anglesCovered = [...framesByAngle.keys()];
  if (anglesCovered.length) {
    agg.notes.unshift(
      `Multi-angle coverage: ${anglesCovered.join(", ")} (${anglesCovered.length}/4 required slots)`,
    );
  }
  if (deduped.length) {
    agg.notes.push(
      `Detected ${deduped.length} issue${deduped.length === 1 ? "" : "s"}: ${deduped
        .map((i) => i.label)
        .slice(0, 6)
        .join("; ")}`,
    );
  } else if (allFrames.length) {
    agg.notes.push("No material cosmetic issues detected from photos");
  }

  return {
    method: "local-cv",
    framesAnalyzed: allFrames.length,
    images,
    videos,
    crackDensity: agg.crackDensity,
    scratchIndex: agg.scratchIndex,
    discoloration: agg.discoloration,
    sharpness: agg.sharpness,
    brightness: agg.brightness,
    screenLikelihood: agg.screenLikelihood,
    screenScore: agg.screenScore,
    bodyScore: agg.bodyScore,
    notes: agg.notes,
    dominantScenario: agg.dominantScenario,
    poweredOffLikely: agg.poweredOffLikely,
    edgePreviewUrl,
    issues: deduped,
    perAngle,
    anglesCovered,
  };
}
