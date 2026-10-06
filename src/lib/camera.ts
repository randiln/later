/**
 * Camera helpers for the capture screen.
 */

import { fitWithinPixels } from "./imageProcessing";

/**
 * Ask for the full 4:3 sensor (12 MP on most phones). `ideal` never fails: the
 * browser picks the closest mode it supports. Without these, most browsers
 * default to 640×480.
 */
export function cameraConstraints(facing: "environment" | "user"): MediaTrackConstraints {
  return {
    facingMode: facing,
    width: { ideal: 4032 },
    height: { ideal: 3024 },
  };
}

/** Kill switch for the still-photo path, in case a device misbehaves in the field. */
const USE_IMAGE_CAPTURE = true;

export interface StillPhoto {
  source: ImageBitmap;
  width: number;
  height: number;
  release: () => void;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * Take a photo through the phone's still-image pipeline (ImageCapture — Chrome on
 * Android). That yields the camera's real photo processing instead of a video
 * frame. Requests a size within the 12 MP budget (sensors can be 50–200 MP).
 *
 * Returns null when unsupported or on any failure; callers fall back to the video frame.
 */
export async function takeStillPhoto(track: MediaStreamTrack): Promise<StillPhoto | null> {
  const ImageCaptureCtor = (window as any).ImageCapture;
  if (!USE_IMAGE_CAPTURE || !ImageCaptureCtor || track.readyState !== "live") return null;

  try {
    const imageCapture = new ImageCaptureCtor(track);
    const caps = await withTimeout<any>(imageCapture.getPhotoCapabilities(), 1500);

    const settings: Record<string, unknown> = {};
    const maxW = caps?.imageWidth?.max;
    const maxH = caps?.imageHeight?.max;
    if (maxW && maxH) {
      const fit = fitWithinPixels(maxW, maxH);
      settings.imageWidth = fit.width;
      settings.imageHeight = fit.height;
    }
    // Flash is handled by the torch pulse on the video path; keep the still path flash-free.
    if (caps?.fillLightMode?.includes?.("off")) settings.fillLightMode = "off";

    const blob: Blob = await withTimeout(imageCapture.takePhoto(settings), 4000);
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch (err) {
    console.warn("Still photo capture unavailable, using video frame:", err);
    return null;
  }
}
