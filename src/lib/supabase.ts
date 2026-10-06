import { createClient } from "@supabase/supabase-js";

const rawSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || "";
const supabaseAnonKey = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "").trim();

// Normalize the project URL. Common copy-paste mistakes break Storage uploads:
//  - trailing whitespace/newlines
//  - a trailing slash -> SDK builds ".../co//storage/v1/..." (double slash),
//    which the API gateway rejects as "invalid path in the specified request url"
//  - an accidental "/storage/v1" suffix -> path gets doubled
const supabaseUrl = rawSupabaseUrl
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/storage\/v1$/, "");

/** Whether Supabase Storage is configured. Photo upload requires this. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    "Supabase environment variables are missing. Photo upload will be disabled. " +
    "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local file."
  );
}

// createClient throws synchronously on an empty URL, which would crash the
// entire app at load. Fall back to a valid placeholder so the app still
// renders; uploadJpeg guards against an unconfigured client below.
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key"
);

/** The Supabase Storage bucket name used for gallery photos. */
export const PHOTOS_BUCKET = "gallery-photos";

/** Long cache: a photo's bytes never change once uploaded. */
const PHOTO_CACHE_SECONDS = "31536000";

/** Relative storage path for a new original: `{galleryId}/{contributorId}/{timestamp}.jpg` */
export function newPhotoPath(galleryId: string, contributorId: string): string {
  return `${galleryId}/${contributorId}/${Date.now()}.jpg`;
}

/** Upload a JPEG blob to `storagePath` in the photos bucket. Throws on failure. */
export async function uploadJpeg(blob: Blob, storagePath: string): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Photo storage is not configured. Please contact the event creator.");
  }

  // Convert Blob → ArrayBuffer so the SDK uses the raw-binary upload path
  // (Content-Type: image/jpeg header) instead of multipart FormData.
  const arrayBuffer = await blob.arrayBuffer();

  const { error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: "image/jpeg",
      cacheControl: PHOTO_CACHE_SECONDS,
      upsert: false,
    });

  if (error) {
    const status = (error as { statusCode?: string | number }).statusCode;
    const endpoint = `${supabaseUrl}/storage/v1/object/${PHOTOS_BUCKET}/${storagePath}`;
    console.error("Supabase upload failed", { endpoint, status, error });
    // Include diagnostics in the message so they appear in the on-screen
    // error toast (useful when no dev tools are available, e.g. mobile).
    throw new Error(
      `Upload failed [${status ?? "?"}]: ${error.message} — project URL: "${supabaseUrl}"`
    );
  }
}

/**
 * Delete photo files (original + any size variants) from Supabase Storage.
 *
 * Logs errors but does not throw — Firestore is the source of truth and
 * orphaned storage files are acceptable.
 */
export async function deletePhotoFiles(paths: Array<string | undefined>): Promise<void> {
  const toDelete = paths.filter((p): p is string => Boolean(p));
  if (toDelete.length === 0) return;

  if (!isSupabaseConfigured) {
    console.warn("Supabase not configured — skipping storage deletion.");
    return;
  }

  try {
    const { error } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .remove(toDelete);

    if (error) {
      console.error("Supabase delete failed:", error);
    }
  } catch (err) {
    console.error("Supabase delete error:", err);
  }
}
