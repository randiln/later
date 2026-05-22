import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, collection, addDoc, getDocs, serverTimestamp } from "firebase/firestore";
import { db, logFirestoreError, OperationType } from "../lib/firebase";
import { Gallery } from "../types";
import PageWrapper from "../components/PageWrapper";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { formatDistanceToNow, isPast } from "date-fns";

export default function Join() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [loading, setLoading] = useState(true);
  const [nickname, setNickname] = useState("");
  const [joining, setJoining] = useState(false);
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    if (!id) return;
    
    const checkStatus = async () => {
      try {
        const docSnap = await getDoc(doc(db, "galleries", id));
        if (!docSnap.exists()) {
          navigate("/");
          return;
        }
        
        const g = { id: docSnap.id, ...docSnap.data() } as Gallery;
        setGallery(g);

        // Check if gallery is full
        const contributorsSnap = await getDocs(collection(db, "galleries", id, "contributors"));
        if (contributorsSnap.size >= g.maxContributors) {
          setIsFull(true);
        }

        // Check if already joined
        const savedContributorId = localStorage.getItem(`contributor_${id}`);
        if (savedContributorId) {
          const cSnap = await getDoc(doc(db, "galleries", id, "contributors", savedContributorId));
          if (cSnap.exists()) {
            if (isPast(g.revealAt.toDate())) {
              navigate(`/gallery/${id}`);
            } else if (isPast(g.startsAt.toDate())) {
              navigate(`/capture/${id}`);
            }
          }
        }
        setLoading(false);
      } catch (error) {
        logFirestoreError(error, OperationType.GET, `galleries/${id}`);
      }
    };

    checkStatus();
  }, [id]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !nickname || joining || isFull) return;
    
    setJoining(true);
    try {
      // Re-verify capacity just before adding
      const contributorsSnap = await getDocs(collection(db, "galleries", id, "contributors"));
      if (contributorsSnap.size >= (gallery?.maxContributors || 0)) {
        setIsFull(true);
        setJoining(false);
        return;
      }

      const sessionId = Math.random().toString(36).substring(7);
      const docRef = await addDoc(collection(db, "galleries", id, "contributors"), {
        galleryId: id,
        nickname,
        sessionId,
        shotsTaken: 0,
        createdAt: serverTimestamp()
      });
      
      localStorage.setItem(`contributor_${id}`, docRef.id);
      localStorage.setItem(`session_${id}`, sessionId);
      
      navigate(`/capture/${id}`);
    } catch (error) {
      logFirestoreError(error, OperationType.WRITE, `galleries/${id}/contributors`);
    } finally {
      setJoining(false);
    }
  };

  if (loading) return null;
  if (!gallery) return null;

  const hasStarted = isPast(gallery.startsAt.toDate());

  if (!hasStarted) {
    return (
      <PageWrapper>
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-10">
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Badge label="Locked" />
          </motion.div>
          
          <div className="space-y-4">
            <h2 className="text-5xl font-serif italic text-white/90">{gallery.title}</h2>
            <div className="text-4xl font-serif italic text-accent py-4">
              {formatDistanceToNow(gallery.startsAt.toDate())}
            </div>
          </div>

          <p className="text-text-muted max-w-[280px] mx-auto text-sm leading-relaxed italic">
            “The memories haven’t started yet. Grab a drink, find your seat. We open soon.”
          </p>

          <p className="text-[10px] text-zinc-800 uppercase tracking-widest font-bold">
            Come back when the event begins ✨
          </p>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="flex-1 flex flex-col pt-12 space-y-12">
        <div className="space-y-4">
          <div className="flex justify-center">
            <Badge label="Live Now" tone="live" />
          </div>
          <h2 className="text-4xl font-serif italic text-center leading-tight text-white/90">
            Join the camera for<br/> {gallery.title}
          </h2>
          <p className="text-text-muted text-center text-sm italic">
            Add your perspective to the shared memory.
          </p>
        </div>

        <form onSubmit={handleJoin} className="space-y-6">
          <div className="space-y-1">
             <label className="text-[10px] uppercase tracking-[0.2em] font-bold text-text-muted ml-1">Nickname</label>
             <input
               disabled={isFull}
               autoFocus
               required
               maxLength={20}
               placeholder={isFull ? "Gallery is full" : "What should we call you?"}
               className="w-full bg-transparent border-b border-white/10 focus:border-accent p-4 text-center text-2xl outline-none transition-colors font-serif italic disabled:opacity-30"
               value={nickname}
               onChange={(e) => setNickname(e.target.value)}
             />
          </div>
          
          <Button type="submit" disabled={!nickname || joining || isFull}>
            <span>{isFull ? "Gallery at Capacity" : joining ? "Entering..." : "Enter Gallery"}</span>
            {!isFull && !joining && <ArrowRight size={20} />}
          </Button>
        </form>
      </div>
    </PageWrapper>
  );
}
