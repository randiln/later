/**
 * Camera helpers for the capture screen.
 *
 * Two resolutions, like a native camera app:
 *   - the live viewfinder stream, kept small enough to run smoothly
 *   - the saved photo, taken at up to 12 MP
 *
 * Chrome (ImageCapture available): viewfinder at 1920×1440, full-resolution stills
 * via ImageCapture.takePhoto(). Chrome copies every camera frame on the CPU, so a
 * 12 MP stream makes the viewfinder stutter.
 * Safari / iOS (no ImageCapture): the stream itself is the photo source, so ask for
 * the full sensor; iOS handles high-resolution streams on the GPU.
 */

import { fitWithinPixels } from "./imageProcessing";

/** Kill switch for full-resolution stills via ImageCapture (Chrome). */
const USE_IMAGE_CAPTURE = true;

/** How long the background still may take before we settle for the viewfinder frame. */
const STILL_TIMEOUT_MS = 3000;

export function supportsStillCapture(): boolean {
  return USE_IMAGE_CAPTURE && typeof (window as any).ImageCapture === "function";
}

/**
 * `ideal` values never fail: the browser picks the closest mode it supports.
 * Without them, most browsers default to 640×480.
 */
export function cameraConstraints(facing: "environment" | "user"): MediaTrackConstraints {
  const [width, height] = supportsStillCapture() ? [1920, 1440] : [4032, 3024];
  return {
    facingMode: facing,
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: 30 },
  };
}

export interface CapturedFrame {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

/** One ImageCapture (and its photo settings) per camera track; capabilities are slow to query. */
const stillCapturers = new WeakMap<MediaStreamTrack, Promise<{ capture: any; settings: Record<string, unknown> }>>();

function stillCapturerFor(track: MediaStreamTrack) {
  let entry = stillCapturers.get(track);
  if (!entry) {
    entry = (async () => {
      const capture = new (window as any).ImageCapture(track);
      const caps = await withTimeout<any>(capture.getPhotoCapabilities(), 1500);
      const settings: Record<string, unknown> = {};
      const maxW = caps?.imageWidth?.max;
      const maxH = caps?.imageHeight?.max;
      if (maxW && maxH) {
        // Sensors can be 50–200 MP; ask for the 12 MP budget.
        const fit = fitWithinPixels(maxW, maxH);
        settings.imageWidth = fit.width;
        settings.imageHeight = fit.height;
      }
      // Flash shots use the torch + viewfinder frame; keep the still path flash-free.
      if (caps?.fillLightMode?.includes?.("off")) settings.fillLightMode = "off";
      return { capture, settings };
    })();
    entry.catch(() => stillCapturers.delete(track));
    stillCapturers.set(track, entry);
  }
  return entry;
}

/** Warm up ImageCapture for this track so the first shot doesn't pay for setup. */
export function prepareStillCapture(track: MediaStreamTrack | undefined) {
  if (track && supportsStillCapture()) stillCapturerFor(track).catch(() => {});
}

/**
 * Take a full-resolution photo through the phone's still-image pipeline (Chrome).
 * Returns null when unsupported, slow, or failing; callers keep the viewfinder frame.
 */
export async function takeStillPhoto(track: MediaStreamTrack): Promise<CapturedFrame | null> {
  if (!supportsStillCapture() || track.readyState !== "live") return null;
  try {
    const { capture, settings } = await stillCapturerFor(track);
    const blob: Blob = await withTimeout(capture.takePhoto(settings), STILL_TIMEOUT_MS);
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch (err) {
    console.warn("Full-resolution still unavailable, keeping the viewfinder frame:", err);
    return null;
  }
}

/** Snapshot the current viewfinder frame. Near-instant. */
export async function grabFrame(video: HTMLVideoElement): Promise<CapturedFrame> {
  try {
    const bitmap = await createImageBitmap(video);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    // Older browsers: copy the frame through a canvas first.
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const bitmap = await createImageBitmap(canvas);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
}

/**
 * The photo to save: the full-resolution still if it arrives in time and matches the
 * viewfinder's orientation (the rotation logic assumes they match), else the frame.
 * Takes ownership of both bitmaps and closes the one not used.
 */
export async function pickBestSource(frame: CapturedFrame, still: Promise<CapturedFrame | null>): Promise<{ source: CapturedFrame; usedStill: boolean }> {
  const s = await still;
  if (s && (s.height > s.width) === (frame.height > frame.width) && s.width * s.height > frame.width * frame.height) {
    frame.bitmap.close();
    return { source: s, usedStill: true };
  }
  if (s) {
    console.warn("Still photo orientation/size not usable; keeping the viewfinder frame");
    s.bitmap.close();
  }
  return { source: frame, usedStill: false };
}

/** Human-readable stream info for the ?camdebug overlay. */
export function describeTrack(track: MediaStreamTrack | undefined): string {
  if (!track) return "no camera";
  const s = track.getSettings();
  const fps = s.frameRate ? `${Math.round(s.frameRate)}fps` : "?fps";
  return `viewfinder ${s.width}×${s.height} ${fps} · stills ${supportsStillCapture() ? "on" : "off"}`;
}
