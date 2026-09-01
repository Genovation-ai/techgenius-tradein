const MAX_DIM = 480;

/** Decode an image URL into ImageData (downscaled for speed). */
export async function loadImageData(url: string): Promise<ImageData> {
  const img = await loadHtmlImage(url);
  return rasterize(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
}

/** Sample several frames from a video blob URL. */
export async function extractVideoFrames(url: string, count = 4): Promise<ImageData[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  await waitForEvent(video, "loadedmetadata");
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
  const frames: ImageData[] = [];

  for (let i = 0; i < count; i++) {
    const t = duration * ((i + 0.5) / count);
    video.currentTime = Math.min(t, Math.max(duration - 0.05, 0));
    await waitForEvent(video, "seeked");
    frames.push(rasterize(video, video.videoWidth || 640, video.videoHeight || 480));
  }

  video.removeAttribute("src");
  video.load();
  return frames;
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image for local vision."));
    img.src = url;
  });
}

function rasterize(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
): ImageData {
  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH, 1));
  const w = Math.max(32, Math.round(srcW * scale));
  const h = Math.max(32, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D unavailable for local vision.");
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function waitForEvent(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`Media ${event} failed`));
    };
    const cleanup = () => {
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
    };
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

export function imageDataToEdgePreview(gray: Float32Array, w: number, h: number, mag: Float32Array): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const out = ctx.createImageData(w, h);
  let max = 1;
  for (let i = 0; i < mag.length; i++) max = Math.max(max, mag[i]);
  for (let i = 0; i < mag.length; i++) {
    const v = Math.min(255, Math.round((mag[i] / max) * 255));
    const o = i * 4;
    out.data[o] = v;
    out.data[o + 1] = v;
    out.data[o + 2] = v;
    out.data[o + 3] = 255;
  }
  // silence unused — gray kept for future overlays
  void gray;
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.7);
}
