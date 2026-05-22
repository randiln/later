import { createClient } from "@supabase/supabase-js";

const rawSupabaseUrl = ((import.meta.env.VITE_SUPABASE_URL as string) || "").trim();
const supabaseAnonKey = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "").trim();

// A Supabase project URL is always just the origin (https://<ref>.supabase.co).
// Users often paste a full API path like ".../rest/v1" or ".../storage/v1" by
// mistake; the SDK then builds malformed request URLs that the API gateway
// rejects with "invalid path specified in request URL". Reduce to the origin
// so any appended path, trailing slash, or whitespace is dropped.
let supabaseUrl = "";
try {
  supabaseUrl = rawSupabaseUrl ? new URL(rawSupabaseUrl).origin : "";
} catch {
  console.warn(`VITE_SUPABASE_URL is not a valid URL: "${rawSupabaseUrl}"`);
}

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
// renders; uploadPhoto guards against an unconfigured client below.
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key"
);

/** The Supabase Storage bucket name used for gallery photos. */
export const PHOTOS_BUCKET = "gallery-photos";

/**
 * Upload a JPEG blob to Supabase Storage and return the public URL.
 *
 * Files are stored as: `{galleryId}/{contributorId}/{timestamp}.jpg`
 */
export async function uploadPhoto(
  blob: Blob,
  galleryId: string,
  contributorId: string
): Promise<string> {
  if (!isSupabaseConfigured) {
    throw new Error("Photo storage is not configured. Please contact the event creator.");
  }

  const filename = `${galleryId}/${contributorId}/${Date.now()}.jpg`;

  // Convert Blob → ArrayBuffer so the SDK uses the raw-binary upload path
  // (Content-Type: image/jpeg header) instead of multipart FormData.
  const arrayBuffer = await blob.arrayBuffer();

  const { error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(filename, arrayBuffer, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    const status = (error as { statusCode?: string | number }).statusCode;
    const endpoint = `${supabaseUrl}/storage/v1/object/${PHOTOS_BUCKET}/${filename}`;
    console.error("Supabase upload failed", { endpoint, status, error });
    // Include diagnostics in the message so they appear in the on-screen
    // error toast (useful when no dev tools are available, e.g. mobile).
    throw new Error(
      `Upload failed [${status ?? "?"}]: ${error.message} — project URL: "${supabaseUrl}"`
    );
  }

  const { data } = supabase.storage
    .from(PHOTOS_BUCKET)
    .getPublicUrl(filename);

  return data.publicUrl;
}
