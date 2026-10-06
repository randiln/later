import { deleteField, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { Gallery } from "../types";

/** "Private reveal": only the host sees the photos at reveal until they share them. */
export function isHostFirst(gallery: Pick<Gallery, "releaseMode">): boolean {
  return gallery.releaseMode === "host";
}

/** Whether guests may see the photos once revealed. Mirrors the photos read rule in firestore.rules. */
export function guestsCanView(gallery: Pick<Gallery, "releaseMode" | "sharedAt">): boolean {
  return !isHostFirst(gallery) || Boolean(gallery.sharedAt);
}

/** Share a host-first gallery with guests, or make it private again. Creator only. */
export function setGalleryShared(galleryId: string, shared: boolean): Promise<void> {
  return updateDoc(doc(db, "galleries", galleryId), {
    sharedAt: shared ? serverTimestamp() : deleteField(),
  });
}

/** Change the release mode. Allowed by the rules only before the reveal. */
export function setReleaseMode(galleryId: string, mode: "auto" | "host"): Promise<void> {
  return updateDoc(doc(db, "galleries", galleryId), { releaseMode: mode });
}
