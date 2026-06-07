/**
 * Centralised image URL construction for Supabase Storage transformed images.
 *
 * All photo documents store a relative `storagePath` (e.g. "galleryId/contributorId/timestamp.jpg").
 * This module constructs the appropriate Supabase URL with transformation parameters
 * for each rendering context.
 */

const supabaseUrl = ((import.meta.env.VITE_SUPABASE_URL as string) || "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/storage\/v1$/, "");

const BUCKET = "gallery-photos";

/**
 * Thumbnail URL for the masonry gallery grid.
 * Optimised for fast loading: small dimensions, moderate quality, WebP format.
 */
export function getThumbnailUrl(storagePath: string): string {
  return `${supabaseUrl}/storage/v1/render/image/public/${BUCKET}/${storagePath}?width=400&quality=70&format=webp`;
}

/**
 * Full-size URL for the lightbox carousel.
 * High quality for detail viewing, but still compressed vs raw.
 */
export function getFullSizeUrl(storagePath: string): string {
  return `${supabaseUrl}/storage/v1/render/image/public/${BUCKET}/${storagePath}?width=1600&quality=80&format=webp`;
}

/**
 * Raw (untransformed) public URL for downloads.
 * Returns the original JPEG at upload quality.
 */
export function getRawUrl(storagePath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}
