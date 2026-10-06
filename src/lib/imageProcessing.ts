/**
 * Client-side image sizing for captured photos. Runs on the main thread or in a
 * Web Worker (OffscreenCanvas), so nothing here may touch the DOM directly.
 *
 * Every shot is stored in three sizes so the reveal doesn't download originals:
 *   - original: full capture, capped at ~12 MP (downloads / "Save")
 *   - display:  1600px long edge (lightbox)
 *   - thumb:    480px long edge (gallery grid)
 */

/** Pixel budget for the original. 4032×3024 (12.19 MP) passes untouched. */
export const MAX_PIXELS = 12_200_000;

/** iOS Safari refuses canvases larger than 4096×4096 in area, so stay under it. */
const MAX_CANVAS_AREA = 16_777_216;

export const ORIGINAL_QUALITY = 0.88;

export const VARIANTS = {
  display: { maxEdge: 1600, quality: 0.8, suffix: "_md" },
  thumb: { maxEdge: 480, quality: 0.7, suffix: "_th" },
} as const;

export type VariantName = keyof typeof VARIANTS;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * How to turn a camera frame into the saved photo: the source crop (digital zoom),
 * an optional quarter turn (landscape shots from a portrait stream), and the output size.
 */
export interface RenderParams {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** 0 = none, 1 = 90° clockwise, -1 = 90° counter-clockwise */
  rotate: 0 | 1 | -1;
  outW: number;
  outH: number;
}

export interface EncodedPhoto {
  original: Blob;
  display: Blob | null;
  thumb: Blob | null;
  width: number;
  height: number;
}

/** Scale (w, h) down uniformly so w × h ≤ maxPixels. Never scales up. */
export function fitWithinPixels(w: number, h: number, maxPixels = MAX_PIXELS): { width: number; height: number } {
  const budget = Math.min(maxPixels, MAX_CANVAS_AREA);
  if (w * h <= budget) return { width: w, height: h };
  const scale = Math.sqrt(budget / (w * h));
  return { width: Math.floor(w * scale), height: Math.floor(h * scale) };
}

/** Scale (w, h) down uniformly so the long edge ≤ maxEdge. Never scales up. */
export function fitWithinEdge(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const longEdge = Math.max(w, h);
  if (longEdge <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longEdge;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Work out crop, rotation and output size for a frame.
 * @param zoomRatio digital zoom (1 = none) — crops the centre, never upscales
 * @param deviceAngle physical orientation: 0, 90, 180 or 270
 */
export function computeRenderParams(frameW: number, frameH: number, zoomRatio: number, deviceAngle: number): RenderParams {
  const sw = frameW / zoomRatio;
  const sh = frameH / zoomRatio;
  const isDeviceLandscape = deviceAngle === 90 || deviceAngle === 270;
  // Device held landscape but the stream is portrait: turn the image a quarter.
  // 90 (landscape right) → clockwise; 270 (landscape left) → counter-clockwise.
  const rotate: RenderParams["rotate"] = isDeviceLandscape && frameH > frameW ? (deviceAngle === 90 ? 1 : -1) : 0;
  const cropW = Math.round(rotate ? sh : sw);
  const cropH = Math.round(rotate ? sw : sh);
  const { width: outW, height: outH } = fitWithinPixels(cropW, cropH);
  return { sx: (frameW - sw) / 2, sy: (frameH - sh) / 2, sw, sh, rotate, outW, outH };
}

/** Same crop and rotation, smaller output (for the instant on-screen preview). */
export function scaleRenderParams(p: RenderParams, maxEdge: number): RenderParams {
  const { width, height } = fitWithinEdge(p.outW, p.outH, maxEdge);
  return { ...p, outW: width, outH: height };
}

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: AnyCanvas): AnyContext {
  const ctx = canvas.getContext("2d") as AnyContext | null;
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

export function encodeJpeg(canvas: AnyCanvas, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/jpeg", quality });
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Draw `source` into a new canvas according to `p`. */
export function renderToCanvas(source: CanvasImageSource, p: RenderParams): AnyCanvas {
  const canvas = createCanvas(p.outW, p.outH);
  drawRendered(context2d(canvas), source, p);
  return canvas;
}

/**
 * Draw an on-screen preview (a DOM canvas) without encoding anything: JPEG encoding
 * on the main thread runs in idle time and can take a second during animations.
 */
export function renderPreviewCanvas(source: CanvasImageSource, p: RenderParams, maxEdge: number): HTMLCanvasElement {
  const scaled = scaleRenderParams(p, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = scaled.outW;
  canvas.height = scaled.outH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  drawRendered(ctx, source, scaled);
  return canvas;
}

function drawRendered(ctx: AnyContext, source: CanvasImageSource, p: RenderParams) {
  if (p.rotate) {
    ctx.translate(p.outW / 2, p.outH / 2);
    ctx.rotate((p.rotate * Math.PI) / 2);
    ctx.drawImage(source, p.sx, p.sy, p.sw, p.sh, -p.outH / 2, -p.outW / 2, p.outH, p.outW);
  } else {
    ctx.drawImage(source, p.sx, p.sy, p.sw, p.sh, 0, 0, p.outW, p.outH);
  }
}

/**
 * Downscale a canvas to fit `maxEdge`. Halves repeatedly before the final draw:
 * a single large-ratio drawImage aliases badly (notably in Safari), while
 * successive halvings stay sharp.
 */
export function downscaleCanvas(source: AnyCanvas, maxEdge: number): AnyCanvas {
  const target = fitWithinEdge(source.width, source.height, maxEdge);
  let current = source;

  while (current.width / 2 >= target.width && current.height / 2 >= target.height) {
    current = drawScaled(current, Math.round(current.width / 2), Math.round(current.height / 2));
  }
  if (current.width !== target.width || current.height !== target.height) {
    current = drawScaled(current, target.width, target.height);
  }
  return current;
}

function drawScaled(source: AnyCanvas, width: number, height: number): AnyCanvas {
  const canvas = createCanvas(width, height);
  context2d(canvas).drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Render the full-size photo and encode all three sizes. The slow part of a capture. */
export async function encodePhoto(source: CanvasImageSource, p: RenderParams): Promise<EncodedPhoto> {
  const canvas = renderToCanvas(source, p);
  const original = await encodeJpeg(canvas, ORIGINAL_QUALITY);
  if (!original) throw new Error("Failed to encode photo");

  const displayCanvas = downscaleCanvas(canvas, VARIANTS.display.maxEdge);
  const thumbCanvas = downscaleCanvas(displayCanvas, VARIANTS.thumb.maxEdge);
  const [display, thumb] = await Promise.all([
    encodeJpeg(displayCanvas, VARIANTS.display.quality),
    encodeJpeg(thumbCanvas, VARIANTS.thumb.quality),
  ]);
  return { original, display, thumb, width: p.outW, height: p.outH };
}

/** Derive a variant's storage path from the original's: `a/b/123.jpg` → `a/b/123_th.jpg`. */
export function variantPath(originalPath: string, variant: VariantName): string {
  return originalPath.replace(/\.jpg$/, `${VARIANTS[variant].suffix}.jpg`);
}
