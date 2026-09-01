/** Lightweight image ops — runs fully in the browser */

export function toGray(data: ImageData): Float32Array {
  const { data: px, width, height } = data;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    out[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }
  return out;
}

/** Sobel magnitude map */
export function sobelMagnitude(gray: Float32Array, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] +
        gray[i - w + 1] -
        2 * gray[i - 1] +
        2 * gray[i + 1] -
        gray[i + w - 1] +
        gray[i + w + 1];
      const gy =
        -gray[i - w - 1] -
        2 * gray[i - w] -
        gray[i - w + 1] +
        gray[i + w - 1] +
        2 * gray[i + w] +
        gray[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

/** Laplacian variance — blur detection */
export function laplacianVariance(gray: Float32Array, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        -4 * gray[i] + gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.max(0, sumSq / n - mean * mean);
}

export function meanStd(values: Float32Array): { mean: number; std: number } {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const mean = sum / values.length;
  let varSum = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    varSum += d * d;
  }
  return { mean, std: Math.sqrt(varSum / values.length) };
}

/** Local contrast via mean absolute difference from box mean (approx scuffs) */
export function localContrastIndex(gray: Float32Array, w: number, h: number, radius = 2): number {
  let acc = 0;
  let n = 0;
  for (let y = radius; y < h - radius; y += 2) {
    for (let x = radius; x < w - radius; x += 2) {
      let local = 0;
      let c = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          local += gray[(y + dy) * w + (x + dx)];
          c++;
        }
      }
      const mean = local / c;
      acc += Math.abs(gray[y * w + x] - mean);
      n++;
    }
  }
  return n ? acc / n / 255 : 0;
}

export function regionStats(
  gray: Float32Array,
  mag: Float32Array,
  w: number,
  _h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  let edge = 0;
  let bright = 0;
  let n = 0;
  let strong = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      bright += gray[i];
      edge += mag[i];
      if (mag[i] > 80) strong++;
      n++;
    }
  }
  return {
    meanBright: n ? bright / n : 0,
    meanEdge: n ? edge / n : 0,
    strongRatio: n ? strong / n : 0,
  };
}
