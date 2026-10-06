/**
 * Background upload queue for captured photos.
 *
 * Shots are saved to IndexedDB the moment they're encoded, then uploaded one at a
 * time (venue networks are weak; parallel uploads just compete). Failures retry
 * with backoff and immediately when the phone comes back online. If the page is
 * closed, pending shots resume the next time the camera opens.
 *
 * Every step is safe to repeat: storage paths and the Firestore photo id are fixed
 * at capture time, and "already exists" from storage counts as success.
 */

export interface QueuedPhoto {
  /** Firestore photo document id, chosen at capture time. */
  id: string;
  galleryId: string;
  contributorId: string;
  storagePath: string;
  displayPath: string;
  thumbPath: string;
  original: Blob;
  display: Blob | null;
  thumb: Blob | null;
  width: number;
  height: number;
  createdAt: number;
  done: { original?: boolean; display?: boolean; thumb?: boolean };
  /** The Firestore write was sent at least once (it may have landed before a reload). */
  commitIssued?: boolean;
  attempts: number;
}

export interface QueueState {
  /** Photos not yet saved. */
  queued: number;
  /** Last attempt failed; waiting to retry. */
  retrying: boolean;
}

interface QueueOptions {
  galleryId: string;
  upload: (blob: Blob, path: string) => Promise<void>;
  /** Write the photo doc + shot increment. Throw an error with code "permission-denied" for permanent refusals. */
  commit: (item: QueuedPhoto) => Promise<void>;
  onChange: (state: QueueState) => void;
  onSaved: (item: QueuedPhoto) => void;
  onFailed: (item: QueuedPhoto, message: string) => void;
}

const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
const ORIGINAL_UPLOAD_TIMEOUT_MS = 90_000;
const VARIANT_UPLOAD_TIMEOUT_MS = 30_000;

/* ───────────── IndexedDB (falls back to memory, e.g. some private modes) ───────────── */

const DB_NAME = "later";
const STORE = "pendingPhotos";
let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryStore = new Map<string, QueuedPhoto>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function dbRequest<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveItem(item: QueuedPhoto) {
  memoryStore.set(item.id, item);
  try { await dbRequest("readwrite", (s) => s.put(item)); } catch (err) { console.warn("Couldn't persist pending photo", err); }
}

async function removeItem(id: string) {
  memoryStore.delete(id);
  try { await dbRequest("readwrite", (s) => s.delete(id)); } catch {}
}

async function loadItems(galleryId: string): Promise<QueuedPhoto[]> {
  let items: QueuedPhoto[] = [];
  try { items = (await dbRequest<QueuedPhoto[]>("readonly", (s) => s.getAll())) ?? []; } catch {}
  for (const item of memoryStore.values()) if (!items.some((i) => i.id === item.id)) items.push(item);
  return items.filter((i) => i.galleryId === galleryId).sort((a, b) => a.createdAt - b.createdAt);
}

/* ─────────────────────────────── Queue ─────────────────────────────── */

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms)),
  ]);
}

function isDuplicate(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("[409]") || /already exists|duplicate/i.test(msg);
}

export class PhotoUploadQueue {
  private items: QueuedPhoto[] = [];
  private running = false;
  private stopped = false;
  private retrying = false;
  private wake: (() => void) | null = null;
  private readonly onOnline = () => this.wake?.();

  constructor(private opts: QueueOptions) {}

  /**
   * Load anything left over from a previous visit and start uploading.
   * Resolves with how many leftovers are not yet counted in the guest's shotsTaken.
   */
  async start(): Promise<number> {
    window.addEventListener("online", this.onOnline);
    const leftovers = await loadItems(this.opts.galleryId);
    let uncounted = 0;
    for (const item of leftovers) {
      if (this.items.some((i) => i.id === item.id)) continue;
      this.items.push(item);
      if (!item.commitIssued) uncounted++;
    }
    this.items.sort((a, b) => a.createdAt - b.createdAt);
    this.emit();
    this.run();
    return uncounted;
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("online", this.onOnline);
    this.wake?.();
  }

  async enqueue(item: QueuedPhoto) {
    this.items.push(item);
    this.emit();
    await saveItem(item);
    this.run();
  }

  get state(): QueueState {
    return { queued: this.items.length, retrying: this.retrying };
  }

  private emit() {
    this.opts.onChange(this.state);
  }

  private async run() {
    if (this.running || this.stopped) return;
    this.running = true;
    let failures = 0;
    while (!this.stopped && this.items.length > 0) {
      const item = this.items[0];
      try {
        await this.process(item);
        await this.finish(item);
        this.opts.onSaved(item);
        failures = 0;
      } catch (err: any) {
        if (err?.code === "permission-denied") {
          await this.finish(item);
          if (item.commitIssued && item.attempts > 0) {
            // An earlier write most likely landed before a reload; the retry is refused as a duplicate.
            console.warn("Photo write refused on retry; assuming the earlier write succeeded", item.id);
            this.opts.onSaved(item);
          } else {
            this.opts.onFailed(item, err.message || "This photo couldn't be saved.");
          }
          continue;
        }
        console.warn("Photo upload failed, will retry", err);
        item.attempts++;
        failures++;
        saveItem(item);
        this.retrying = true;
        this.emit();
        await this.sleep(RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)]);
        this.retrying = false;
        this.emit();
      }
    }
    this.running = false;
  }

  private async process(item: QueuedPhoto) {
    if (!item.done.original) {
      await this.uploadOnce(item.original, item.storagePath, ORIGINAL_UPLOAD_TIMEOUT_MS);
      item.done.original = true;
      await saveItem(item);
    }

    // Smaller sizes are best-effort (in parallel, two tries each); if one fails the gallery uses the original.
    const variants = [
      ["display", item.display, item.displayPath],
      ["thumb", item.thumb, item.thumbPath],
    ] as const;
    await Promise.all(variants.map(async ([key, blob, path]) => {
      if (!blob || item.done[key]) return;
      for (let attempt = 0; attempt < 2 && !item.done[key]; attempt++) {
        try {
          await this.uploadOnce(blob, path, VARIANT_UPLOAD_TIMEOUT_MS);
          item.done[key] = true;
        } catch (err) {
          console.warn(`Optional ${key} upload failed`, err);
        }
      }
    }));

    item.commitIssued = true;
    await saveItem(item);
    await this.opts.commit(item);
  }

  private async uploadOnce(blob: Blob, path: string, timeoutMs: number) {
    try {
      await withTimeout(this.opts.upload(blob, path), timeoutMs);
    } catch (err) {
      // A retry of an upload that actually completed: treat as done.
      if (isDuplicate(err)) return;
      throw err;
    }
  }

  private async finish(item: QueuedPhoto) {
    this.items = this.items.filter((i) => i.id !== item.id);
    await removeItem(item.id);
    this.emit();
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = () => {
        this.wake = null;
        done();
      };
    });
  }
}
