import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, collection, query, orderBy, getDocs, onSnapshot } from "firebase/firestore";
import { db, logFirestoreError, OperationType } from "../lib/firebase";
import { Gallery, Photo, Contributor } from "../types";
import PageWrapper from "../components/PageWrapper";
import Badge from "../components/Badge";
import LoadingScreen from "../components/LoadingScreen";
import { motion, AnimatePresence } from "motion/react";
import { Camera } from "lucide-react";
import { format } from "date-fns";

export default function GalleryView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [contributors, setContributors] = useState<Record<string, Contributor>>({});
  const [loading, setLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);

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
              onClick={() => setSelectedPhoto(photo)}
              className="relative aspect-[3/4] bg-card rounded-2xl overflow-hidden active:scale-95 transition-transform group"
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
        {selectedPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-2xl flex flex-col items-center justify-center p-6"
            onClick={() => setSelectedPhoto(null)}
          >
            <motion.div 
               initial={{ scale: 0.9, y: 20 }}
               animate={{ scale: 1, y: 0 }}
               className="relative w-full max-w-sm aspect-[3/4] bg-card rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/5"
            >
              <img src={selectedPhoto.imageUrl} className="w-full h-full object-cover" />
              <div className="absolute bottom-0 inset-x-0 p-8 bg-gradient-to-t from-black to-transparent">
                 <p className="text-3xl font-serif italic text-accent">{contributors[selectedPhoto.contributorId]?.nickname}</p>
                 <p className="text-xs text-text-muted mt-2 font-medium uppercase tracking-widest">{format(selectedPhoto.createdAt.toDate(), "MMMM do, h:mm a")}</p>
              </div>
            </motion.div>
            
            <button 
              className="mt-10 px-8 py-4 bg-white text-black rounded-full font-bold text-xs uppercase tracking-[0.2em] shadow-xl shadow-accent/5"
              onClick={() => setSelectedPhoto(null)}
            >
              Close Memory
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </PageWrapper>
  );
}
