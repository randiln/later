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

/**
 * The still-photo path (ImageCapture, Chrome on Android) gives better processing but
 * adds 0.3–2 s of shutter lag on many phones, so the shot lands after the moment.
 * Off by default: an instant frame from the full-resolution stream feels far better.
 */
const USE_IMAGE_CAPTURE = false;

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

/**
 * Take a photo through the phone's still-image pipeline (ImageCapture — Chrome on
 * Android). That yields the camera's real photo processing instead of a video
 * frame. Requests a size within the 12 MP budget (sensors can be 50–200 MP).
 *
 * Returns null when unsupported or on any failure; callers fall back to the video frame.
 */
export async function takeStillPhoto(track: MediaStreamTrack): Promise<CapturedFrame | null> {
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
    return { bitmap, width: bitmap.width, height: bitmap.height };
  } catch (err) {
    console.warn("Still photo capture unavailable, using video frame:", err);
    return null;
  }
}

/**
 * Grab the current frame as fast as possible. Uses the still-photo path when enabled
 * and its orientation matches the preview; otherwise snapshots the video element.
 */
export async function grabFrame(video: HTMLVideoElement, track: MediaStreamTrack | undefined, allowStill: boolean): Promise<CapturedFrame> {
  if (allowStill && track) {
    const still = await takeStillPhoto(track);
    if (still) {
      if ((still.height > still.width) === (video.videoHeight > video.videoWidth)) return still;
      // Orientation differs from the preview; the rotation logic assumes they match.
      console.warn("Still photo orientation differs from preview; using video frame");
      still.bitmap.close();
    }
    // Some devices end or pause the preview stream after a still capture.
    if (video.paused) video.play().catch(() => {});
  }

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
