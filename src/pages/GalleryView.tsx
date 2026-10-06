import React, { useEffect, useState, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, collection, query, orderBy, getDocs, onSnapshot, deleteDoc } from "firebase/firestore";
import { db, auth, logFirestoreError, OperationType } from "../lib/firebase";
import { deletePhotoFiles } from "../lib/supabase";
import { getThumbnailUrl, getFullSizeUrl, getRawUrl } from "../lib/imageUrl";
import { Gallery, Photo, Contributor } from "../types";
import PageWrapper from "../components/PageWrapper";
import Badge from "../components/Badge";
import LoadingScreen from "../components/LoadingScreen";
import { motion, AnimatePresence } from "motion/react";
import { Camera, ChevronLeft, ChevronRight, Trash2, Download, X, EyeOff, Share2 } from "lucide-react";
import { guestsCanView, isHostFirst, setGalleryShared } from "../lib/gallery";
import { format } from "date-fns";
import JSZip from "jszip";

/* ─────────────────────────── Lightbox Swipe Carousel ─────────────────────────
 * Architecture: instead of animating individual slides in/out (which fights
 * with drag gestures), we render a horizontal strip of 3 slides [prev, cur, next]
 * and translate the whole strip.  While the user's finger is down the strip
 * follows it 1:1 via a ref-driven CSS transform (no React re-renders → 60 fps).
 * On release we decide whether to commit the swipe or snap back, apply a CSS
 * transition, then update React state once the transition ends.
 * ──────────────────────────────────────────────────────────────────────────── */

function LightboxCarousel({
  photos,
  contributors,
  selectedIndex,
  onChangeIndex,
  onClose,
  isCreator,
  onDelete,
  confirmDelete,
  deleting,
  onDownload,
}: {
  photos: Photo[];
  contributors: Record<string, Contributor>;
  selectedIndex: number;
  onChangeIndex: (i: number) => void;
  onClose: () => void;
  isCreator: boolean;
  onDelete: () => void;
  confirmDelete: boolean;
  deleting: boolean;
  onDownload: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const currentOffset = useRef(0);
  const isHorizontalSwipe = useRef<boolean | null>(null); // null = undecided
  const committed = useRef(false); // prevent double-commit

  const SWIPE_THRESHOLD = 60;       // px needed to commit
  const VELOCITY_THRESHOLD = 0.3;   // px/ms — fast flick commits even if short
  const startTime = useRef(0);

  // The strip has 3 slides: [prev, curr, next]. Each is 100vw wide.
  // To show the center (curr) slide, we offset by -1 × viewport width.
  const getBaseOffset = () => -window.innerWidth;

  // Translate the strip without re-rendering React
  const setTranslate = (px: number, transition = "none") => {
    if (!stripRef.current) return;
    stripRef.current.style.transition = transition;
    stripRef.current.style.transform = `translateX(${getBaseOffset() + px}px)`;
  };

  // Reset strip to center (current photo) instantly
  useEffect(() => {
    setTranslate(0);
    committed.current = false;
  }, [selectedIndex]);

  /* ── pointer / touch handlers ── */
  const onPointerDown = (e: React.PointerEvent) => {
    // Ignore if tapping buttons
    if ((e.target as HTMLElement).closest("button")) return;
    isDragging.current = true;
    isHorizontalSwipe.current = null;
    startX.current = e.clientX;
    startY.current = e.clientY;
    startTime.current = Date.now();
    currentOffset.current = 0;
    committed.current = false;
    setTranslate(0);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;

    // Lock direction on first significant movement
    if (isHorizontalSwipe.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      isHorizontalSwipe.current = Math.abs(dx) >= Math.abs(dy);
    }

    // If user is scrolling vertically, bail
    if (isHorizontalSwipe.current === false) return;
    if (isHorizontalSwipe.current === null) return; // still undecided

    // Rubber-band at edges
    let clamped = dx;
    if ((selectedIndex === 0 && dx > 0) || (selectedIndex === photos.length - 1 && dx < 0)) {
      clamped = dx * 0.25; // rubber-band resistance
    }

    currentOffset.current = clamped;
    setTranslate(clamped);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;

    if (isHorizontalSwipe.current !== true) {
      // Was a vertical scroll or a tap — snap back
      setTranslate(0, "transform 0.25s cubic-bezier(.25,.1,.25,1)");
      return;
    }

    const dx = currentOffset.current;
    const elapsed = Date.now() - startTime.current;
    const velocity = Math.abs(dx) / Math.max(elapsed, 1);
    const committedSwipe =
      Math.abs(dx) > SWIPE_THRESHOLD || velocity > VELOCITY_THRESHOLD;

    if (committed.current) return;

    if (committedSwipe && dx < 0 && selectedIndex < photos.length - 1) {
      // Swipe left → next
      committed.current = true;
      const vw = window.innerWidth;
      setTranslate(-vw, "transform 0.3s cubic-bezier(.25,.1,.25,1)");
      setTimeout(() => onChangeIndex(selectedIndex + 1), 300);
    } else if (committedSwipe && dx > 0 && selectedIndex > 0) {
      // Swipe right → prev
      committed.current = true;
      const vw = window.innerWidth;
      setTranslate(vw, "transform 0.3s cubic-bezier(.25,.1,.25,1)");
      setTimeout(() => onChangeIndex(selectedIndex - 1), 300);
    } else {
      // Snap back
      setTranslate(0, "transform 0.3s cubic-bezier(.25,.1,.25,1)");
    }
  };

  const prevPhoto = selectedIndex > 0 ? photos[selectedIndex - 1] : null;
  const currPhoto = photos[selectedIndex];
  const nextPhoto = selectedIndex < photos.length - 1 ? photos[selectedIndex + 1] : null;

  const renderSlide = (photo: Photo | null, key: string) => {
    if (!photo) return <div key={key} className="w-full shrink-0" />;
    return (
      <div key={key} className="w-full shrink-0 px-6 flex items-center justify-center">
        <div className="max-w-lg w-full">
          <div className="bg-card rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/5">
            <img
              src={getFullSizeUrl(photo)}
              className="w-full max-h-[65vh] object-contain bg-black"
              draggable={false}
            />
            <div className="p-6 bg-gradient-to-t from-card to-card/80">
              <p className="text-2xl font-serif italic text-accent">
                {contributors[photo.contributorId]?.nickname || "Guest"}
              </p>
              <p className="text-xs text-text-muted mt-1 font-medium uppercase tracking-widest">
                {format(photo.createdAt.toDate(), "MMMM do, h:mm a")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center overflow-hidden touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-6 right-6 z-10 w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center active:scale-90 transition-transform"
      >
        <X size={18} className="text-white/70" />
      </button>

      {/* Photo counter */}
      <div className="absolute top-7 left-1/2 -translate-x-1/2 z-10">
        <p className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold">
          {selectedIndex + 1} / {photos.length}
        </p>
      </div>

      {/* Navigation arrows (desktop) */}
      {selectedIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onChangeIndex(selectedIndex - 1); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center active:scale-90 transition-transform"
        >
          <ChevronLeft size={20} className="text-white/70" />
        </button>
      )}
      {selectedIndex < photos.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onChangeIndex(selectedIndex + 1); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center active:scale-90 transition-transform"
        >
          <ChevronRight size={20} className="text-white/70" />
        </button>
      )}

      {/* 3-slide strip */}
      <div className="flex-1 flex items-center w-full overflow-hidden">
        <div
          ref={stripRef}
          className="flex w-full will-change-transform"
          style={{ transform: `translateX(${-window.innerWidth}px)` }}
        >
          {renderSlide(prevPhoto, `prev-${prevPhoto?.id || "empty"}`)}
          {renderSlide(currPhoto, `curr-${currPhoto.id}`)}
          {renderSlide(nextPhoto, `next-${nextPhoto?.id || "empty"}`)}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center space-x-4 py-6">
        <button
          onClick={onDownload}
          className="px-6 py-3 bg-white/10 backdrop-blur-md text-white rounded-full font-bold text-xs uppercase tracking-[0.15em] flex items-center space-x-2 active:scale-95 transition-transform"
        >
          <Download size={14} />
          <span>Save</span>
        </button>

        {isCreator && (
          <button
            onClick={onDelete}
            disabled={deleting}
            className={`px-6 py-3 rounded-full font-bold text-xs uppercase tracking-[0.15em] flex items-center space-x-2 active:scale-95 transition-all ${
              confirmDelete
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-white/10 backdrop-blur-md text-red-400'
            } disabled:opacity-50`}
          >
            <Trash2 size={14} />
            <span>{deleting ? "Deleting..." : confirmDelete ? "Tap to Confirm" : "Delete"}</span>
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────── Grid layout helpers ───────────────────────────── */

/** Photos rendered per "page" as the guest scrolls; keeps the DOM small for large events. */
const GRID_PAGE_SIZE = 60;
/** Photos per zip when downloading everything; keeps phone memory in check. */
const ZIP_CHUNK_SIZE = 200;
/** Parallel fetches while zipping. */
const DOWNLOAD_CONCURRENCY = 4;

function isLandscapePhoto(photo: Photo): boolean {
  return photo.width && photo.height ? photo.width > photo.height : false;
}

/**
 * Masonry by shortest column. Deterministic for any prefix of `photos`, so
 * appending a page never moves tiles that are already on screen (CSS columns would).
 */
function layoutColumns(photos: Photo[], columnCount: number): { photo: Photo; index: number }[][] {
  const columns: { photo: Photo; index: number }[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array(columnCount).fill(0);
  photos.forEach((photo, index) => {
    const shortest = heights.indexOf(Math.min(...heights));
    columns[shortest].push({ photo, index });
    heights[shortest] += isLandscapePhoto(photo) ? 3 / 4 : 4 / 3;
  });
  return columns;
}

function useColumnCount(): number {
  const query = "(min-width: 768px)"; // Tailwind `md`
  const [count, setCount] = useState(() => (window.matchMedia(query).matches ? 3 : 2));
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setCount(mql.matches ? 3 : 2);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return count;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* ─────────────────────────── Main Gallery View ─────────────────────────────── */

export default function GalleryView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [contributors, setContributors] = useState<Record<string, Contributor>>({});
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [sharing, setSharing] = useState(false);

  const [visibleCount, setVisibleCount] = useState(GRID_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const columnCount = useColumnCount();

  const isCreator = auth.currentUser?.uid === gallery?.creatorId;
  const selectedPhoto = selectedIndex !== null ? photos[selectedIndex] : null;

  const columns = useMemo(
    () => layoutColumns(photos.slice(0, visibleCount), columnCount),
    [photos, visibleCount, columnCount]
  );

  // Render the next page of tiles when the guest is within ~1.5 screens of the bottom.
  // Also re-checked after every page renders, so a tall screen fills itself.
  useEffect(() => {
    if (loading || visibleCount >= photos.length) return;
    const check = () => {
      const sentinel = sentinelRef.current;
      if (sentinel && sentinel.getBoundingClientRect().top < window.innerHeight * 2.5) {
        setVisibleCount((c) => Math.min(c + GRID_PAGE_SIZE, photos.length));
      }
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [photos.length, visibleCount, loading]);

  useEffect(() => {
    if (!id) return;

    let unsubPhotos: (() => void) | undefined;
    let contributorsRequested = false;
    const stopPhotos = () => {
      unsubPhotos?.();
      unsubPhotos = undefined;
    };

    // Live gallery doc: picks up the host sharing (or un-sharing) a private reveal.
    const unsubGallery = onSnapshot(doc(db, "galleries", id), (gDoc) => {
      if (!gDoc.exists()) {
        navigate("/");
        return;
      }
      const gData = { id: gDoc.id, ...gDoc.data() } as Gallery;
      setGallery(gData);

      if (gData.revealAt.toDate() > new Date()) {
        navigate(`/join/${id}`);
        return;
      }

      const canView = auth.currentUser?.uid === gData.creatorId || guestsCanView(gData);
      if (!canView) {
        // Private reveal not shared yet: the rules would reject the photos query.
        stopPhotos();
        setPhotos([]);
        setLoading(false);
        return;
      }
      if (unsubPhotos) return;

      // Fetch contributors to map names
      if (!contributorsRequested) {
        contributorsRequested = true;
        getDocs(collection(db, "galleries", id, "contributors"))
          .then((cSnap) => {
            const cMap: Record<string, Contributor> = {};
            cSnap.forEach(doc => {
              cMap[doc.id] = { id: doc.id, ...doc.data() } as Contributor;
            });
            setContributors(cMap);
          })
          .catch((error) => logFirestoreError(error, OperationType.LIST, `galleries/${id}/contributors`));
      }

      // Listen for photos
      const q = query(collection(db, "galleries", id, "photos"), orderBy("createdAt", "asc"));
      unsubPhotos = onSnapshot(q, (snap) => {
        const pList: Photo[] = [];
        snap.forEach(doc => pList.push({ id: doc.id, ...doc.data() } as Photo));
        setPhotos(pList);
        setLoading(false);
      }, (error) => {
        logFirestoreError(error, OperationType.LIST, `galleries/${id}/photos`);
        setLoading(false);
      });
    }, (error) => {
      logFirestoreError(error, OperationType.GET, `galleries/${id}`);
    });

    return () => {
      unsubGallery();
      stopPhotos();
    };
  }, [id]);

  // Keyboard navigation
  useEffect(() => {
    if (selectedIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && selectedIndex < photos.length - 1) {
        setSelectedIndex(selectedIndex + 1);
        setConfirmDelete(false);
      } else if (e.key === "ArrowLeft" && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
        setConfirmDelete(false);
      } else if (e.key === "Escape") {
        setSelectedIndex(null);
        setConfirmDelete(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIndex, photos.length]);

  // Delete photo
  const handleDelete = async () => {
    if (!selectedPhoto || !id || deleting) return;

    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setDeleting(true);
    try {
      await deletePhotoFiles([selectedPhoto.storagePath, selectedPhoto.displayPath, selectedPhoto.thumbPath]);
      await deleteDoc(doc(db, "galleries", id, "photos", selectedPhoto.id));

      if (photos.length <= 1) {
        setSelectedIndex(null);
      } else if (selectedIndex! >= photos.length - 1) {
        setSelectedIndex(selectedIndex! - 1);
      }
      setConfirmDelete(false);
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setDeleting(false);
    }
  };

  // Download photo
  const handleDownload = async () => {
    if (!selectedPhoto) return;
    try {
      const response = await fetch(getRawUrl(selectedPhoto));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      
      const nickname = contributors[selectedPhoto.contributorId]?.nickname || "Guest";
      let dateStr = "unknown";
      try {
        dateStr = format(selectedPhoto.createdAt.toDate(), "yyyy-MM-dd_HH-mm-ss");
      } catch {}
      a.download = `${nickname}_${dateStr}.jpg`;
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  // Bulk download gallery — zips of ZIP_CHUNK_SIZE photos so phones don't run out of memory.
  const handleDownloadAll = async () => {
    if (photos.length === 0 || downloadingAll || !gallery) return;
    setDownloadingAll(true);
    setDownloadProgress(0);

    const sanitizedTitle = gallery.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const indexWidth = Math.max(2, String(photos.length).length);
    const chunkCount = Math.ceil(photos.length / ZIP_CHUNK_SIZE);
    let done = 0;

    try {
      for (let chunk = 0; chunk < chunkCount; chunk++) {
        const zip = new JSZip();
        const chunkStart = chunk * ZIP_CHUNK_SIZE;
        const chunkPhotos = photos.slice(chunkStart, chunkStart + ZIP_CHUNK_SIZE);

        // Small worker pool: DOWNLOAD_CONCURRENCY fetches in flight at a time.
        let next = 0;
        const worker = async () => {
          while (next < chunkPhotos.length) {
            const offset = next++;
            const photo = chunkPhotos[offset];
            const nickname = contributors[photo.contributorId]?.nickname || "Guest";
            let dateStr = "unknown";
            try {
              dateStr = format(photo.createdAt.toDate(), "yyyy-MM-dd_HH-mm-ss");
            } catch {}

            // Format name: 0001_Nickname_2026-06-08_10-40-00.jpg
            const n = String(chunkStart + offset + 1).padStart(indexWidth, '0');
            const response = await fetch(getRawUrl(photo));
            if (!response.ok) throw new Error(`Failed to fetch photo ${photo.id}`);
            zip.file(`${n}_${nickname}_${dateStr}.jpg`, await response.blob());

            done++;
            setDownloadProgress(Math.round((done / photos.length) * 100));
          }
        };
        await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const suffix = chunkCount > 1 ? `_part${chunk + 1}of${chunkCount}` : "";
        triggerDownload(zipBlob, `${sanitizedTitle}_memories${suffix}.zip`);
      }
    } catch (error) {
      console.error("Bulk download failed:", error);
      alert("Failed to download gallery. Please try again.");
    } finally {
      setDownloadingAll(false);
    }
  };

  if (loading || !gallery) return <LoadingScreen message="Unlocking memories..." />;

  // Private reveal, not shared yet — guests wait here; the snapshot listener swaps in the photos once shared.
  if (!isCreator && !guestsCanView(gallery)) {
    return (
      <PageWrapper>
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-10">
          <Badge label="Almost ready" />
          <div className="space-y-4">
            <h2 className="text-4xl font-serif italic text-white/90 leading-tight">{gallery.title}</h2>
            <p className="text-text-muted text-sm max-w-[280px] mx-auto italic leading-relaxed">
              The host is putting the finishing touches on your gallery. This page will open by itself the moment it's shared.
            </p>
          </div>
        </div>
      </PageWrapper>
    );
  }

  const handleToggleShared = async () => {
    if (!id || sharing) return;
    setSharing(true);
    try {
      await setGalleryShared(id, !gallery.sharedAt);
    } catch (err) {
      logFirestoreError(err, OperationType.UPDATE, `galleries/${id}`);
      alert("Couldn't update sharing. Please try again.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <PageWrapper>
      <div className="flex flex-col items-center text-center space-y-6 mb-12">
        <Badge label="Revealed" />
        <div className="space-y-3">
          <h2 className="text-5xl font-serif italic text-white/90">{gallery.title}</h2>
          <p className="text-text-muted text-[10px] font-bold uppercase tracking-[0.2em]">
            Memories from {format(gallery.revealAt.toDate(), "MMMM do, yyyy")}
          </p>
        </div>

        {isCreator && isHostFirst(gallery) && (
          <div className="w-full p-4 rounded-2xl bg-card border border-accent/20 flex items-center gap-3 text-left">
            {gallery.sharedAt ? <Share2 size={16} className="text-accent shrink-0" /> : <EyeOff size={16} className="text-accent shrink-0" />}
            <p className="flex-1 text-xs text-text-muted">
              {gallery.sharedAt ? "Shared with your guests." : "Only you can see these photos."}
            </p>
            <button
              onClick={handleToggleShared}
              disabled={sharing}
              className={`shrink-0 px-4 py-2 rounded-full font-bold text-[10px] uppercase tracking-[0.15em] active:scale-95 transition-all disabled:opacity-50 ${
                gallery.sharedAt ? "bg-white/10 text-white/80" : "bg-accent text-zinc-950"
              }`}
            >
              {sharing ? "Saving..." : gallery.sharedAt ? "Make private" : "Share with guests"}
            </button>
          </div>
        )}

        {photos.length > 0 && (
          <div className="pt-2">
            <button
              onClick={handleDownloadAll}
              disabled={downloadingAll}
              className={`px-6 py-3 rounded-full font-bold text-xs uppercase tracking-[0.15em] flex items-center space-x-2 transition-all duration-300 shadow-md border ${
                downloadingAll
                  ? 'bg-accent/20 border-accent/40 text-accent cursor-not-allowed'
                  : 'bg-white/10 hover:bg-white text-white hover:text-black border-white/10 hover:border-transparent active:scale-95'
              } cursor-pointer`}
            >
              {downloadingAll ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                  <span>Zipping ({downloadProgress}%)</span>
                </>
              ) : (
                <>
                  <Download size={14} />
                  <span>Download Gallery</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-4 items-start">
        {columns.map((column, c) => (
          <div key={c} className="flex-1 min-w-0 flex flex-col gap-4">
            <AnimatePresence>
              {column.map(({ photo, index }) => (
                <motion.div
                  key={photo.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  // Short stagger within each newly rendered page only, capped so later tiles never wait.
                  transition={{ delay: Math.min(index % GRID_PAGE_SIZE, 12) * 0.03 }}
                  onClick={() => { setSelectedIndex(index); setConfirmDelete(false); }}
                  className={`relative ${
                    isLandscapePhoto(photo) ? "aspect-[4/3]" : "aspect-[3/4]"
                  } bg-card rounded-2xl overflow-hidden active:scale-95 transition-transform group cursor-pointer [content-visibility:auto]`}
                >
                  <img
                    src={getThumbnailUrl(photo)}
                    className="w-full h-full object-cover transition-all duration-700 group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent p-4 flex flex-col justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                     <p className="text-xs text-accent font-serif italic">
                       {contributors[photo.contributorId]?.nickname || "Guest"}
                     </p>
                     <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mt-1">
                        {format(photo.createdAt.toDate(), "h:mm a")}
                     </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ))}
      </div>
      {visibleCount < photos.length && <div ref={sentinelRef} className="h-px" />}

      {photos.length === 0 && (
         <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-4 opacity-20">
            <Camera size={48} strokeWidth={1} />
            <p className="font-serif italic text-xl">The camera remained empty.</p>
         </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {selectedPhoto && selectedIndex !== null && (
          <LightboxCarousel
            photos={photos}
            contributors={contributors}
            selectedIndex={selectedIndex}
            onChangeIndex={(i) => { setSelectedIndex(i); setConfirmDelete(false); }}
            onClose={() => { setSelectedIndex(null); setConfirmDelete(false); }}
            isCreator={isCreator}
            onDelete={handleDelete}
            confirmDelete={confirmDelete}
            deleting={deleting}
            onDownload={handleDownload}
          />
        )}
      </AnimatePresence>
    </PageWrapper>
  );
}
