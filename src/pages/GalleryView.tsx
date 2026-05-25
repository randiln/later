import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, collection, query, orderBy, getDocs, onSnapshot, deleteDoc } from "firebase/firestore";
import { db, auth, logFirestoreError, OperationType } from "../lib/firebase";
import { deletePhoto as deletePhotoFromStorage } from "../lib/supabase";
import { Gallery, Photo, Contributor } from "../types";
import PageWrapper from "../components/PageWrapper";
import Badge from "../components/Badge";
import LoadingScreen from "../components/LoadingScreen";
import { motion, AnimatePresence } from "motion/react";
import { Camera, ChevronLeft, ChevronRight, Trash2, Download, X } from "lucide-react";
import { format } from "date-fns";

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
  const [slideDir, setSlideDir] = useState<1 | -1>(1);

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

  // Navigation
  const goNext = useCallback(() => {
    if (selectedIndex === null) return;
    if (selectedIndex < photos.length - 1) {
      setSlideDir(1);
      setSelectedIndex(selectedIndex + 1);
      setConfirmDelete(false);
    }
  }, [selectedIndex, photos.length]);

  const goPrev = useCallback(() => {
    if (selectedIndex === null) return;
    if (selectedIndex > 0) {
      setSlideDir(-1);
      setSelectedIndex(selectedIndex - 1);
      setConfirmDelete(false);
    }
  }, [selectedIndex]);

  const closeLightbox = useCallback(() => {
    setSelectedIndex(null);
    setConfirmDelete(false);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (selectedIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIndex, goNext, goPrev, closeLightbox]);

  // Delete photo
  const handleDelete = async () => {
    if (!selectedPhoto || !id || deleting) return;

    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setDeleting(true);
    try {
      // Delete from Supabase Storage (best-effort)
      await deletePhotoFromStorage(selectedPhoto.imageUrl);

      // Delete Firestore doc
      await deleteDoc(doc(db, "galleries", id, "photos", selectedPhoto.id));

      // Advance to next photo or close
      if (photos.length <= 1) {
        closeLightbox();
      } else if (selectedIndex! >= photos.length - 1) {
        setSelectedIndex(selectedIndex! - 1);
      }
      // else stay at same index — the array will shift
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
      const response = await fetch(selectedPhoto.imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `later-${selectedPhoto.id}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  if (loading || !gallery) return <LoadingScreen message="Unlocking memories..." />;

  return (
    <PageWrapper>
      <div className="flex flex-col space-y-4 mb-12 text-center">
        <div className="flex justify-center">
           <Badge label="Revealed" />
        </div>
        <div>
          <h2 className="text-5xl font-serif italic text-white/90">{gallery.title}</h2>
          <p className="text-text-muted text-xs font-medium uppercase tracking-[0.2em] mt-4">Memories from {format(gallery.revealAt.toDate(), "MMMM do, yyyy")}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <AnimatePresence>
          {photos.map((photo, i) => (
            <motion.div
              key={photo.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => { setSelectedIndex(i); setSlideDir(1); setConfirmDelete(false); }}
              className="relative aspect-[3/4] bg-card rounded-2xl overflow-hidden active:scale-95 transition-transform group cursor-pointer"
            >
              <img 
                src={photo.imageUrl} 
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
          ))}
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center"
          >
            {/* Close button */}
            <button
              onClick={closeLightbox}
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

            {/* Navigation arrows */}
            {selectedIndex > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); goPrev(); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center active:scale-90 transition-transform"
              >
                <ChevronLeft size={20} className="text-white/70" />
              </button>
            )}
            {selectedIndex < photos.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); goNext(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center active:scale-90 transition-transform"
              >
                <ChevronRight size={20} className="text-white/70" />
              </button>
            )}

            {/* Photo display */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={selectedPhoto.id}
                initial={{ opacity: 0, x: slideDir * 320 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: slideDir * -320 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.6}
                onDragEnd={(event, info) => {
                  const swipeThreshold = 50;
                  if (info.offset.x < -swipeThreshold) {
                    goNext();
                  } else if (info.offset.x > swipeThreshold) {
                    goPrev();
                  }
                }}
                className="relative max-w-lg w-full px-6 cursor-grab active:cursor-grabbing"
              >
                <div className="bg-card rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/5">
                  <img
                    src={selectedPhoto.imageUrl}
                    className="w-full max-h-[65vh] object-contain bg-black"
                  />
                  <div className="p-6 bg-gradient-to-t from-card to-card/80">
                    <p className="text-2xl font-serif italic text-accent">
                      {contributors[selectedPhoto.contributorId]?.nickname || "Guest"}
                    </p>
                    <p className="text-xs text-text-muted mt-1 font-medium uppercase tracking-widest">
                      {format(selectedPhoto.createdAt.toDate(), "MMMM do, h:mm a")}
                    </p>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Action buttons */}
            <div className="flex items-center space-x-4 mt-6">
              <button
                onClick={handleDownload}
                className="px-6 py-3 bg-white/10 backdrop-blur-md text-white rounded-full font-bold text-xs uppercase tracking-[0.15em] flex items-center space-x-2 active:scale-95 transition-transform"
              >
                <Download size={14} />
                <span>Save</span>
              </button>

              {isCreator && (
                <button
                  onClick={handleDelete}
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
        )}
      </AnimatePresence>
    </PageWrapper>
  );
}
