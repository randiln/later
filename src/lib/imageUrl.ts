/**
 * Centralised image URL construction for Supabase Storage.
 *
 * Each photo is stored in up to three sizes (see `imageProcessing.ts`). Photos taken
 * before sizes existed only have `storagePath`, so every helper falls back to it.
 */

import { Photo } from "../types";

const supabaseUrl = ((import.meta.env.VITE_SUPABASE_URL as string) || "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/storage\/v1$/, "");

const BUCKET = "gallery-photos";

type PhotoPaths = Pick<Photo, "storagePath" | "displayPath" | "thumbPath">;

function publicUrl(path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** 480px copy for the gallery grid. */
export function getThumbnailUrl(photo: PhotoPaths): string {
  return publicUrl(photo.thumbPath || photo.displayPath || photo.storagePath);
}

/** 1600px copy for the lightbox. */
export function getFullSizeUrl(photo: PhotoPaths): string {
  return publicUrl(photo.displayPath || photo.storagePath);
}

/** Original upload, for downloads. */
export function getRawUrl(photo: PhotoPaths): string {
  return publicUrl(photo.storagePath);
}
