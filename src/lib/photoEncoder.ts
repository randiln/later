/**
 * Encodes photos in a Web Worker when the browser supports OffscreenCanvas there,
 * otherwise on the main thread. Call `warmUpPhotoEncoder()` early so the worker is
 * ready (and probed) before the first shot.
 */
import { encodePhoto, EncodedPhoto, RenderParams } from "./imageProcessing";

let worker: Worker | null = null;
let workerReady: Promise<boolean> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: EncodedPhoto) => void; reject: (e: Error) => void }>();

export function warmUpPhotoEncoder(): Promise<boolean> {
  if (workerReady) return workerReady;
  workerReady = new Promise<boolean>((resolve) => {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return resolve(false);
    try {
      worker = new Worker(new URL("../workers/photoEncoder.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return resolve(false);
    }
    const timeout = setTimeout(() => resolve(false), 3000);
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "probe") {
        clearTimeout(timeout);
        resolve(Boolean(msg.ok));
        return;
      }
      const job = pending.get(msg.id);
      if (!job) return;
      pending.delete(msg.id);
      if (msg.error) job.reject(new Error(msg.error));
      else job.resolve(msg.result);
    };
    worker.onerror = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    worker.postMessage({ type: "probe" });
  }).then((ok) => {
    if (!ok) {
      worker?.terminate();
      worker = null;
    }
    return ok;
  });
  return workerReady;
}

/**
 * Render and encode all three sizes of a photo. Takes ownership of `bitmap`
 * (it is transferred to the worker or closed afterwards).
 */
export async function encodePhotoInBackground(bitmap: ImageBitmap, params: RenderParams): Promise<EncodedPhoto> {
  const useWorker = await warmUpPhotoEncoder();
  if (useWorker && worker) {
    const id = nextId++;
    return new Promise<EncodedPhoto>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker!.postMessage({ type: "encode", id, bitmap, params }, [bitmap]);
    });
  }
  try {
    return await encodePhoto(bitmap, params);
  } finally {
    bitmap.close();
  }
}
