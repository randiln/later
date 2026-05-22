import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

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
    // Surface everything we know so the real cause is visible in the console.
    console.error("Supabase upload failed", {
      bucket: PHOTOS_BUCKET,
      path: filename,
      supabaseUrl,
      objectEndpoint: `${supabaseUrl}/storage/v1/object/${PHOTOS_BUCKET}/${filename}`,
      error,
      status: (error as { statusCode?: string }).statusCode,
    });
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  const { data } = supabase.storage
    .from(PHOTOS_BUCKET)
    .getPublicUrl(filename);

  return data.publicUrl;
}
