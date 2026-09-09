import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, Film, Trash2, Upload, CheckCircle2, Square } from "lucide-react";
import type { ValuationAnswers } from "../data/catalog";
import { gradeLabels } from "../data/catalog";
import { runGeniusAiScan } from "../lib/aiScan";
import { ANGLE_META, REQUIRED_ANGLES } from "../lib/localVision/issues";
import type { AiScanResult, MediaFile, PhotoAngle } from "../lib/tradeInTypes";
import "./FormSteps.css";
import "./AiScanStep.css";

interface Props {
  valuation: ValuationAnswers;
  media: MediaFile[];
  onMediaChange: (files: MediaFile[]) => void;
  onSkip: () => void;
  onComplete: (result: AiScanResult) => void;
}

function pushMedia(
  current: MediaFile[],
  file: File,
  angle: PhotoAngle,
): MediaFile[] {
  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  if (!isVideo && !isImage) throw new Error("Please upload photos or a short video.");
  if (file.size > 40 * 1024 * 1024) throw new Error("Each file must be under 40MB.");
  const kind: MediaFile["kind"] = isVideo ? "video" : "image";
  const next: MediaFile = {
    id: `${angle}-${file.name}-${file.size}-${crypto.randomUUID()}`,
    kind,
    name: file.name,
    previewUrl: URL.createObjectURL(file),
    sizeLabel: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
    angle,
    file,
  };
  // Replace existing capture for the same required angle (keep extras additive)
  const withoutSame =
    angle === "extra" ? current : current.filter((m) => m.angle !== angle);
  return [...withoutSame, next].slice(0, 8);
}

export function MediaAiStep({
  valuation,
  media,
  onMediaChange,
  onSkip,
  onComplete,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [activeAngle, setActiveAngle] = useState<PhotoAngle>("front");
  const [phase, setPhase] = useState<"capture" | "scanning" | "result">("capture");
  const [result, setResult] = useState<AiScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [scanMedia, setScanMedia] = useState<MediaFile[] | null>(null);

  const covered = useMemo(() => {
    const set = new Set(media.map((m) => m.angle).filter(Boolean) as PhotoAngle[]);
    return set;
  }, [media]);

  const requiredDone = REQUIRED_ANGLES.filter((a) => covered.has(a)).length;
  const canScan = media.length > 0 && (covered.has("front") || covered.has("back") || media.some((m) => !m.angle));

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (phase !== "scanning" || scanMedia === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await runGeniusAiScan({ valuation, media: scanMedia });
        if (cancelled) return;
        // Nothing was photographed, so there is nothing to report. Showing a
        // findings panel with screen and body scores derived from no photos
        // was a screen that existed only to be clicked past.
        if (scanMedia.length === 0) {
          onComplete(res);
          return;
        }
        setResult(res);
        setPhase("result");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Vision scan failed");
        setPhase("capture");
        setScanMedia(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, valuation, scanMedia, onComplete]);

  const stopCamera = () => {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setCameraOn(false);
    setRecording(false);
  };

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError("Camera access denied or unavailable. Upload a file instead.");
    }
  };

  const advanceAngle = () => {
    const order: PhotoAngle[] = ["front", "back", "left", "right", "extra"];
    const idx = order.indexOf(activeAngle);
    const next = order[Math.min(order.length - 1, idx + 1)];
    setActiveAngle(next);
  };

  const snapPhoto = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `${activeAngle}-${Date.now()}.jpg`, { type: "image/jpeg" });
        try {
          onMediaChange(pushMedia(media, file, activeAngle));
          advanceAngle();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Capture failed");
        }
      },
      "image/jpeg",
      0.9,
    );
  };

  const toggleRecord = () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime });
      const file = new File([blob], `${activeAngle}-${Date.now()}.webm`, { type: mime });
      try {
        onMediaChange(pushMedia(media, file, activeAngle === "extra" ? "extra" : activeAngle));
        advanceAngle();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Recording failed");
      }
    };
    recorder.start();
    setRecording(true);
    window.setTimeout(() => {
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
        setRecording(false);
      }
    }, 8000);
  };

  const addFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setError(null);
    let next = [...media];
    try {
      Array.from(fileList).forEach((file, i) => {
        const angle: PhotoAngle =
          fileList.length === 1 ? activeAngle : (REQUIRED_ANGLES[i] as PhotoAngle) || "extra";
        next = pushMedia(next, file, angle);
      });
      onMediaChange(next);
      if (fileList.length === 1) advanceAngle();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const remove = (id: string) => {
    const target = media.find((m) => m.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onMediaChange(media.filter((m) => m.id !== id));
  };

  const meta = ANGLE_META[activeAngle];

  return (
    <section className="flow-panel ai-panel">
      <header className="flow-header">
        <p className="flow-kicker">Photos</p>
        <h1>Add a few photos?</h1>
        <p className="flow-lead">
          Optional, and it usually helps: photos let us confirm the condition now rather than
          after your device arrives, so the price you see is the price you get. You can skip
          this and go straight to your offer.
        </p>
      </header>

      {phase === "capture" && (
        <div className="ai-intro">
          <div className="angle-slots" role="tablist" aria-label="Photo angles">
            {([...REQUIRED_ANGLES, "extra"] as PhotoAngle[]).map((angle) => {
              const done = covered.has(angle);
              const active = activeAngle === angle;
              return (
                <button
                  key={angle}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`angle-slot${active ? " angle-slot--on" : ""}${done ? " angle-slot--done" : ""}`}
                  onClick={() => setActiveAngle(angle)}
                >
                  <span className="angle-slot-title">{ANGLE_META[angle].title}</span>
                  <span className="angle-slot-status">{done ? "Captured" : "Needed"}</span>
                </button>
              );
            })}
          </div>

          <div className="angle-active-card">
            <strong>{meta.title}</strong>
            <p>{meta.hint}</p>
            <p className="field-hint">
              {requiredDone}/4 required sides · {media.length} file{media.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="media-actions">
            <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              <Upload size={18} /> Upload {meta.title.toLowerCase()}
            </button>
            <button type="button" className="btn btn-dark" onClick={cameraOn ? stopCamera : startCamera}>
              <Camera size={18} /> {cameraOn ? "Close camera" : "Use live camera"}
            </button>
            <input
              id={inputId}
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/*,video/*"
              capture="environment"
              multiple
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {cameraOn ? (
            <div className="camera-box">
              <div className={`camera-guide camera-guide--${activeAngle}`} aria-hidden />
              <video ref={videoRef} muted playsInline autoPlay />
              <div className="media-actions">
                <button type="button" className="btn btn-primary" onClick={snapPhoto}>
                  <Camera size={18} /> Snap {activeAngle}
                </button>
                <button type="button" className="btn btn-secondary" onClick={toggleRecord}>
                  {recording ? <Square size={18} /> : <Film size={18} />}
                  {recording ? "Stop (max 8s)" : "Record clip"}
                </button>
              </div>
            </div>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}

          {media.length > 0 ? (
            <ul className="media-grid">
              {media.map((m) => (
                <li key={m.id} className="media-tile">
                  {m.kind === "image" ? (
                    <img src={m.previewUrl} alt={m.name} />
                  ) : (
                    <video src={m.previewUrl} muted playsInline />
                  )}
                  <div className="media-meta">
                    <span>
                      {m.angle || "photo"} · {m.sizeLabel}
                    </span>
                    <button type="button" aria-label={`Remove ${m.name}`} onClick={() => remove(m.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="field-hint">Start with the front — screen powered on, no heavy glare.</p>
          )}

          <ul className="ai-bullets">
            <li>
              <CheckCircle2 size={18} /> Front must show a lit screen (black/off ≠ cracked)
            </li>
            <li>
              <CheckCircle2 size={18} /> Capture back + both sides for housing damage
            </li>
            <li>
              <CheckCircle2 size={18} /> We detect cracks, scratches, dents, discoloration per side
            </li>
            <li>
              <CheckCircle2 size={18} /> Runs on your phone — blended with your checklist
            </li>
          </ul>

          <div className="media-cta-row">
            <button
              type="button"
              className="btn btn-primary flow-cta"
              disabled={!canScan}
              onClick={() => {
                stopCamera();
                setError(null);
                setScanMedia(media);
                setPhase("scanning");
              }}
            >
              Detect issues &amp; grade
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                stopCamera();
                setError(null);
                onSkip();
                setScanMedia([]);
                setPhase("scanning");
              }}
            >
              Skip photos
            </button>
          </div>
        </div>
      )}

      {phase === "scanning" && (
        <div className="ai-scanning" role="status" aria-live="polite">
          <motion.div
            className="ai-scan-orb"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ repeat: Infinity, duration: 1.6 }}
          >
            <Camera size={32} strokeWidth={1.5} />
          </motion.div>
          <h2>{media.length ? "Inspecting every side…" : "Scoring from checklist…"}</h2>
          <p>
            {media.length
              ? "Detecting cracks, scratches, dents, and discoloration on front, back, and sides."
              : "Matching your checklist to condition bands."}
          </p>
          <div className="ai-scan-bars">
            <motion.span
              initial={{ width: "8%" }}
              animate={{ width: "94%" }}
              transition={{ duration: 2.4, ease: "easeInOut" }}
            />
          </div>
        </div>
      )}

      {phase === "result" && result && (
        <motion.div className="ai-result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="ai-grade-banner">
            Suggested grade: <strong>{gradeLabels[result.suggestedGrade]}</strong>
            {result.usedMedia ? " · multi-angle vision" : " · checklist only"}
          </div>
          <div className="ai-scores">
            <div className="ai-score">
              <span>Screen</span>
              <strong>{result.screenScore}</strong>
            </div>
            <div className="ai-score">
              <span>Body</span>
              <strong>{result.bodyScore}</strong>
            </div>

          </div>

          {result.issues && result.issues.length > 0 ? (
            <div className="issue-chips">
              <h3>Detected issues</h3>
              <ul>
                {result.issues.map((issue) => (
                  <li key={issue.id} className={`issue-chip issue-chip--${issue.severity}`}>
                    <strong>{issue.label}</strong>
                    <span>{issue.angle}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : result.usedMedia ? (
            <p className="field-hint">No material cosmetic issues detected from your photos.</p>
          ) : null}

          {result.perAngle && result.perAngle.length > 0 ? (
            <div className="angle-summary">
              <h3>Per-side scores</h3>
              <div className="angle-summary-grid">
                {result.perAngle.map((a) => (
                  <div key={a.angle} className="angle-summary-card">
                    <strong>{a.angle}</strong>
                    <span>Screen {a.screenScore}</span>
                    <span>Body {a.bodyScore}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {result.vision ? (
            <div className="vision-panel">
              <h3>On-device CV breakdown</h3>
              <p className="field-hint">
                {result.vision.framesAnalyzed} frames · method <code>local-cv</code>
                {result.anglesCovered?.length
                  ? ` · angles ${result.anglesCovered.join(", ")}`
                  : ""}
              </p>
              <div className="vision-metrics">
                <div>
                  <span>Crack / edge</span>
                  <strong>{(result.vision.crackDensity * 100).toFixed(1)}%</strong>
                </div>
                <div>
                  <span>Scratch</span>
                  <strong>{(result.vision.scratchIndex * 100).toFixed(0)}%</strong>
                </div>
                <div>
                  <span>Discoloration</span>
                  <strong>{(result.vision.discoloration * 100).toFixed(0)}%</strong>
                </div>
                <div>
                  <span>Sharpness</span>
                  <strong>{(result.vision.sharpness * 100).toFixed(0)}%</strong>
                </div>
              </div>
              {result.vision.edgePreviewUrl ? (
                <figure className="edge-preview">
                  <img src={result.vision.edgePreviewUrl} alt="Edge detection preview" />
                  <figcaption>Edge map preview</figcaption>
                </figure>
              ) : null}
            </div>
          ) : null}
          <ul className="ai-notes">
            {result.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary flow-cta" onClick={() => onComplete(result)}>
            Review &amp; confirm grade
          </button>
        </motion.div>
      )}
    </section>
  );
}
