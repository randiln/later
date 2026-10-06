/// <reference lib="webworker" />
// Encodes captured photos off the main thread so the camera UI never stutters.
import { encodePhoto, RenderParams } from "../lib/imageProcessing";

type Request =
  | { type: "probe" }
  | { type: "encode"; id: number; bitmap: ImageBitmap; params: RenderParams };

self.onmessage = async (event: MessageEvent<Request>) => {
  const msg = event.data;
  if (msg.type === "probe") {
    let ok = false;
    try {
      const canvas = new OffscreenCanvas(1, 1);
      ok = !!canvas.getContext("2d") && typeof canvas.convertToBlob === "function";
    } catch {}
    self.postMessage({ type: "probe", ok });
    return;
  }

  try {
    const result = await encodePhoto(msg.bitmap, msg.params);
    self.postMessage({ type: "encoded", id: msg.id, result });
  } catch (err) {
    self.postMessage({ type: "encoded", id: msg.id, error: err instanceof Error ? err.message : String(err) });
  } finally {
    msg.bitmap.close();
  }
};
