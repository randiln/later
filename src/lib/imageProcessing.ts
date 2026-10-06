/**
 * Client-side image sizing for captured photos.
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

/** Derive a variant's storage path from the original's: `a/b/123.jpg` → `a/b/123_th.jpg`. */
export function variantPath(originalPath: string, variant: VariantName): string {
  return originalPath.replace(/\.jpg$/, `${VARIANTS[variant].suffix}.jpg`);
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Downscale a canvas to fit `maxEdge`. Halves repeatedly before the final draw:
 * a single large-ratio drawImage aliases badly (notably in Safari), while
 * successive halvings stay sharp.
 */
export function downscaleCanvas(source: HTMLCanvasElement, maxEdge: number): HTMLCanvasElement {
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

function drawScaled(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * Encode the display and thumb sizes from the full-size canvas.
 * The display canvas is reused as the source for the thumb (cheaper, same quality).
 */
export async function createVariants(original: HTMLCanvasElement): Promise<Record<VariantName, Blob | null>> {
  const displayCanvas = downscaleCanvas(original, VARIANTS.display.maxEdge);
  const thumbCanvas = downscaleCanvas(displayCanvas, VARIANTS.thumb.maxEdge);
  const [display, thumb] = await Promise.all([
    canvasToJpeg(displayCanvas, VARIANTS.display.quality),
    canvasToJpeg(thumbCanvas, VARIANTS.thumb.quality),
  ]);
  return { display, thumb };
}
