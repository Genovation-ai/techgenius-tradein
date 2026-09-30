/** Local on-device vision metrics — no cloud APIs */

export type FrameScenario =
  | "powered_off"
  | "black_screen"
  | "too_dark"
  | "glare"
  | "blurry"
  | "no_device"
  | "lit_screen"
  | "cracked_lit"
  | "normal";

/** Required trade-in photo angles for Tech Genius sell / buyback. */
export type PhotoAngle = "front" | "back" | "left" | "right" | "extra";

export type IssueType =
  | "crack"
  | "scratch"
  | "dent"
  | "discoloration"
  | "dead_pixels"
  | "glare"
  | "powered_off"
  | "blurry"
  | "no_device";

export type IssueSeverity = "low" | "medium" | "high";

export interface DetectedIssue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  angle: PhotoAngle;
  confidence: number;
  label: string;
}

export interface FrameAnalysis {
  width: number;
  height: number;
  /** 0–1 fraction of strong edge pixels (crack / shatter cue) */
  crackDensity: number;
  /** 0–1 mid-frequency texture energy (scuffs / scratches) */
  scratchIndex: number;
  /** 0–1 color unevenness / blotching */
  discoloration: number;
  /** 0–1 Laplacian variance proxy (blurry = low) */
  sharpness: number;
  /** 0–1 mean luminance */
  brightness: number;
  /** 0–1 share of near-saturated pixels — a reflection, not overall brightness */
  blownFraction: number;
  /** Heuristic: center looks like lit glass/screen */
  screenLikelihood: number;
  /** Dominant interpretation of this frame */
  scenario: FrameScenario;
  /** 0–1 luminance stddev */
  brightStd: number;
  /** Asymmetry of strong edges (dent / warp cue) */
  edgeAsymmetry?: number;
}

export interface AngleVisionSummary {
  angle: PhotoAngle;
  framesAnalyzed: number;
  screenScore: number;
  bodyScore: number;
  crackDensity: number;
  scratchIndex: number;
  discoloration: number;
  sharpness: number;
  scenario: FrameScenario;
  poweredOffLikely: boolean;
  issues: DetectedIssue[];
}

export interface LocalVisionReport {
  method: "local-cv";
  framesAnalyzed: number;
  images: number;
  videos: number;
  /** Averaged across frames */
  crackDensity: number;
  scratchIndex: number;
  discoloration: number;
  sharpness: number;
  brightness: number;
  screenLikelihood: number;
  /** Derived cosmetic scores 0–100 */
  screenScore: number;
  bodyScore: number;
  notes: string[];
  dominantScenario: FrameScenario;
  poweredOffLikely: boolean;
  /** Optional data-URL of edge preview from first frame */
  edgePreviewUrl?: string;
  /** Structured issues for Tech Genius grade mapping */
  issues: DetectedIssue[];
  /** Per-angle rollups when slots were labeled */
  perAngle: AngleVisionSummary[];
  anglesCovered: PhotoAngle[];
}
