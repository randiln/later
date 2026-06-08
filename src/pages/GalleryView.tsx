import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, collection, query, orderBy, getDocs, onSnapshot, deleteDoc } from "firebase/firestore";
import { db, auth, logFirestoreError, OperationType } from "../lib/firebase";
import { deletePhoto } from "../lib/supabase";
import { getThumbnailUrl, getFullSizeUrl, getRawUrl } from "../lib/imageUrl";
import { Gallery, Photo, Contributor } from "../types";
import PageWrapper from "../components/PageWrapper";
import Badge from "../components/Badge";
import LoadingScreen from "../components/LoadingScreen";
import { motion, AnimatePresence } from "motion/react";
import { Camera, ChevronLeft, ChevronRight, Trash2, Download, X } from "lucide-react";
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
              src={getFullSizeUrl(photo.storagePath)}
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

  const isCreator = auth.currentUser?.uid === gallery?.creatorId;
  const selectedPhoto = selectedIndex !== null ? photos[selectedIndex] : null;

  useEffect(() => {
    if (!id) return;

    let unsubPhotos: (() => void) | undefined;

    const checkReveal = async () => {
      try {
        const gDoc = await getDoc(doc(db, "galleries", id));
        if (!gDoc.exists()) {
          navigate("/");
          return;
        }
        const gData = { id: gDoc.id, ...gDoc.data() } as Gallery;
        setGallery(gData);

        const now = new Date();
        if (gData.revealAt.toDate() > now) {
          navigate(`/join/${id}`);
          return;
        }

        // Fetch contributors to map names
        const cSnap = await getDocs(collection(db, "galleries", id, "contributors"));
        const cMap: Record<string, Contributor> = {};
        cSnap.forEach(doc => {
          cMap[doc.id] = { id: doc.id, ...doc.data() } as Contributor;
        });
        setContributors(cMap);

        // Listen for photos
        const q = query(collection(db, "galleries", id, "photos"), orderBy("createdAt", "asc"));
        unsubPhotos = onSnapshot(q, (snap) => {
          const pList: Photo[] = [];
          snap.forEach(doc => pList.push({ id: doc.id, ...doc.data() } as Photo));
          setPhotos(pList);
          setLoading(false);
        }, (error) => {
          logFirestoreError(error, OperationType.LIST, `galleries/${id}/photos`);
        });
      } catch (error) {
        logFirestoreError(error, OperationType.GET, `galleries/${id}`);
      }
    };

    checkReveal();

    return () => {
      unsubPhotos?.();
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
      await deletePhoto(selectedPhoto.storagePath);
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
      const response = await fetch(getRawUrl(selectedPhoto.storagePath));
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

  // Bulk download gallery
  const handleDownloadAll = async () => {
    if (photos.length === 0 || downloadingAll || !gallery) return;
    setDownloadingAll(true);
    setDownloadProgress(0);

    const zip = new JSZip();

    try {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const nickname = contributors[photo.contributorId]?.nickname || "Guest";
        
        let dateStr = "unknown";
        try {
          dateStr = format(photo.createdAt.toDate(), "yyyy-MM-dd_HH-mm-ss");
        } catch {}

        // Format name: 01_Nickname_2026-06-08_10-40-00.jpg
        const filename = `${String(i + 1).padStart(2, '0')}_${nickname}_${dateStr}.jpg`;

        const response = await fetch(getRawUrl(photo.storagePath));
        if (!response.ok) throw new Error(`Failed to fetch photo ${photo.id}`);
        const blob = await response.blob();
        
        zip.file(filename, blob);
        setDownloadProgress(Math.round(((i + 1) / photos.length) * 100));
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      const sanitizedTitle = gallery.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      a.download = `${sanitizedTitle}_memories.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Bulk download failed:", error);
      alert("Failed to download gallery. Please try again.");
    } finally {
      setDownloadingAll(false);
    }
  };

  if (loading || !gallery) return <LoadingScreen message="Unlocking memories..." />;

  return (
    <PageWrapper>
      <div className="flex flex-col space-y-4 mb-12 text-center">
        <div className="flex justify-between items-center w-full px-4 md:px-0">
          <div className="w-28" /> {/* spacer for symmetry */}
          <Badge label="Revealed" />
          <div className="w-28 flex justify-end">
            {photos.length > 0 && (
              <button
                onClick={handleDownloadAll}
                disabled={downloadingAll}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-full font-bold text-[10px] uppercase tracking-widest flex items-center space-x-1.5 transition-all disabled:opacity-50 cursor-pointer"
              >
                <span>{downloadingAll ? `Zipping (${downloadProgress}%)` : 'Download All'}</span>
              </button>
            )}
          </div>
        </div>
        <div>
          <h2 className="text-5xl font-serif italic text-white/90">{gallery.title}</h2>
          <p className="text-text-muted text-xs font-medium uppercase tracking-[0.2em] mt-4">Memories from {format(gallery.revealAt.toDate(), "MMMM do, yyyy")}</p>
        </div>
      </div>

      <div className="columns-2 md:columns-3 gap-4 space-y-4 [column-fill:_balance] box-border">
        <AnimatePresence>
          {photos.map((photo, i) => {
            const isLandscape = photo.width && photo.height ? photo.width > photo.height : false;
            return (
              <motion.div
                key={photo.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => { setSelectedIndex(i); setConfirmDelete(false); }}
                className={`break-inside-avoid mb-4 relative ${
                  isLandscape ? "aspect-[4/3]" : "aspect-[3/4]"
                } bg-card rounded-2xl overflow-hidden active:scale-95 transition-transform group cursor-pointer`}
              >
                <img 
                  src={getThumbnailUrl(photo.storagePath)} 
                  className="w-full h-full object-cover transition-all duration-700 group-hover:scale-105" 
                  loading="lazy" 
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
            );
          })}
        </AnimatePresence>
      </div>

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
