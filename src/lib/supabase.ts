import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase environment variables are missing. " +
    "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local file."
  );
}

export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");

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
  const filename = `${galleryId}/${contributorId}/${Date.now()}.jpg`;

  const { error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(filename, blob, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  const { data } = supabase.storage
    .from(PHOTOS_BUCKET)
    .getPublicUrl(filename);

  return data.publicUrl;
}
