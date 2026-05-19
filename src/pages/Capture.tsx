import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, onSnapshot, updateDoc, increment, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { uploadPhoto } from "../lib/supabase";
import { Gallery, Photo, Contributor } from "../types";
import PageWrapper from "../components/PageWrapper";
import { motion, AnimatePresence } from "motion/react";
import { Camera, RefreshCcw, LogOut, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow, isPast } from "date-fns";

export default function Capture() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [contributor, setContributor] = useState<Contributor | null>(null);
  const [loading, setLoading] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!id) return;
    const contributorId = localStorage.getItem(`contributor_${id}`);
    if (!contributorId) {
      navigate(`/join/${id}`);
      return;
    }

    const unsubG = onSnapshot(doc(db, "galleries", id), (docSnap) => {
      if (docSnap.exists()) {
        const g = { id: docSnap.id, ...docSnap.data() } as Gallery;
        setGallery(g);
        if (isPast(g.revealAt.toDate())) {
          navigate(`/gallery/${id}`);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `galleries/${id}`);
    });

    const unsubC = onSnapshot(doc(db, "galleries", id, "contributors", contributorId), (docSnap) => {
      if (docSnap.exists()) {
        setContributor({ id: docSnap.id, ...docSnap.data() } as Contributor);
        setLoading(false);
      } else {
        navigate(`/join/${id}`);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `galleries/${id}/contributors/${contributorId}`);
    });

    startCamera();

    return () => {
      unsubG();
      unsubC();
      stopCamera();
    };
  }, [id]);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch (err) {
      console.error("Camera access denied", err);
      setError("Please enable camera access to take photos.");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const takePhoto = async () => {
    if (!videoRef.current || !canvasRef.current || !gallery || !contributor || capturing) return;
    if (contributor.shotsTaken >= gallery.maxShots) return;

    setCapturing(true);
    setError(null);
    const video = videoRef.current;
    const canvas = canvasRef.current;

    // With Supabase Storage we're no longer bound by Firestore's 1MB doc limit,
    // so we can use higher quality and larger dimensions.
    const MAX_DIM = 1200;

    let width = video.videoWidth || 640;
    let height = video.videoHeight || 480;

    if (width > MAX_DIM || height > MAX_DIM) {
      if (width > height) {
        height = Math.round((height * MAX_DIM) / width);
        width = MAX_DIM;
      } else {
        width = Math.round((width * MAX_DIM) / height);
        height = MAX_DIM;
      }
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCapturing(false);
      return;
    }

    ctx.drawImage(video, 0, 0, width, height);

    // Generate a preview data URL for the instant polaroid effect
    const previewUrl = canvas.toDataURL("image/jpeg", 0.5);
    setPreview(previewUrl);

    // Convert canvas to a JPEG blob for Supabase upload
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8)
    );

    if (!blob) {
      setError("Failed to capture image. Please try again.");
      setCapturing(false);
      setPreview(null);
      return;
    }

    // Show 2-second preview then upload
    setTimeout(async () => {
      try {
        setPreview(null);

        // Upload to Supabase Storage and get the public URL
        const imageUrl = await uploadPhoto(blob, id!, contributor.id);

        // Save the Supabase public URL to Firestore
        await addDoc(collection(db, "galleries", id, "photos"), {
          galleryId: id,
          contributorId: contributor.id,
          imageUrl,
          createdAt: serverTimestamp()
        });

        await updateDoc(doc(db, "galleries", id, "contributors", contributor.id), {
          shotsTaken: increment(1)
        });
      } catch (error: any) {
        console.error("Save process failed", error);
        setPreview(null);
        const errorMessage = error?.code === 'permission-denied'
          ? "Permission denied. The gallery may be closed."
          : (error?.message || "Failed to save photo. Please try again.");
        setError(errorMessage);
      } finally {
        setCapturing(false);
      }
    }, 2000);
  };

  if (loading || !gallery || !contributor) return null;

  const shotsLeft = gallery.maxShots - contributor.shotsTaken;

  if (shotsLeft <= 0 && !preview && !capturing) {
    return (
      <PageWrapper>
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-10">
          <div className="px-4 py-1.5 bg-accent/10 border border-accent/20 rounded-full">
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-accent">Reveal Locked</span>
          </div>
          <div className="space-y-4">
            <h2 className="text-4xl font-serif italic text-white/90 leading-tight">Your shots are safe in the vault ✨</h2>
            <p className="text-text-muted text-sm max-w-[280px] mx-auto italic leading-relaxed">
              The camera is closed, the shutter is still. We unlock the secrets soon.
            </p>
          </div>
          <div className="py-8 w-full border-y border-white/5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold mb-4">Reveal Countdown</p>
            <p className="text-5xl font-serif italic text-accent tracking-tight">
              {formatDistanceToNow(gallery.revealAt.toDate())}
            </p>
          </div>

          <p className="text-xs text-zinc-800 font-bold uppercase tracking-widest">
            See you on the other side.
          </p>
        </div>
      </PageWrapper>
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col touch-none select-none grainy">
      {/* Viewport */}
      <div className="relative flex-1 overflow-hidden bg-black flex items-center justify-center">
        {/* Save error toast - shown over camera, dismissable */}
        {error && stream && (
          <div className="absolute top-24 inset-x-4 z-40 bg-red-950/90 backdrop-blur-md border border-red-500/30 rounded-2xl p-4 flex items-start space-x-3">
            <p className="text-red-300 text-xs flex-1 leading-relaxed">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 text-xs font-bold uppercase tracking-widest shrink-0">Dismiss</button>
          </div>
        )}
        {/* Camera access error - full screen */}
        {error && !stream ? (
          <div className="p-10 text-center space-y-4">
            <p className="text-text-muted">{error}</p>
            <button onClick={() => { setError(null); startCamera(); }} className="px-6 py-3 bg-white text-black rounded-full font-bold">Try Again</button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}

        {/* Camera Grid */}
        {!preview && !capturing && (
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="border-[0.5px] border-white/10" />
            ))}
          </div>
        )}

        {/* Shoot Preview Overlay */}
        <AnimatePresence>
          {(preview || capturing) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md"
            >
              {preview && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0, rotate: -2 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  className="relative p-2 bg-white rounded-lg shadow-2xl"
                >
                  <img src={preview} className="w-[75vw] aspect-[3/4] object-cover rounded-sm" />
                  <div className="absolute top-4 right-4 flex items-center space-x-1.5 bg-black/40 backdrop-blur-md px-2 py-1 rounded-full">
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
                    <span className="text-[8px] uppercase tracking-widest font-bold text-white/80">Saving</span>
                  </div>
                </motion.div>
              )}
              {!preview && (
                <div className="mt-8 flex flex-col items-center">
                  <div className="w-10 h-10 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-4" />
                  <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-accent italic">Developing...</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* UI Overlays */}
        <div className="absolute top-0 inset-x-0 p-8 flex justify-between items-start pointer-events-none z-30">
          <div className="bg-black/40 backdrop-blur-xl px-4 py-2.5 rounded-2xl border border-white/10 pointer-events-auto">
            <p className="text-[9px] uppercase tracking-[0.2em] text-white/40 font-bold">Shots Remaining</p>
            <p className="text-xl font-serif italic text-accent leading-none mt-1.5">{shotsLeft} / {gallery.maxShots}</p>
          </div>

          <button
            onClick={() => navigate(-1)}
            className="w-12 h-12 bg-black/40 backdrop-blur-xl rounded-full border border-white/10 flex items-center justify-center pointer-events-auto active:scale-90 transition-transform"
          >
            <LogOut size={18} className="text-white/60" />
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Shutter Bar */}
      <div className="h-[220px] bg-black flex flex-col items-center justify-center relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-px bg-white/5" />

        <div className="flex flex-col items-center space-y-4">
          <button
            disabled={!!preview || capturing || shotsLeft <= 0}
            onClick={takePhoto}
            className="group relative w-20 h-20 rounded-full border-[3px] border-white/20 p-1.5 active:scale-95 transition-transform disabled:opacity-10"
          >
            <div className="w-full h-full bg-white rounded-full transition-all group-active:scale-90 group-active:bg-accent" />
            <div className="absolute -inset-4 border border-accent/0 rounded-full group-active:border-accent/40 group-active:scale-110 transition-all duration-500" />
          </button>

          <p className="text-[10px] uppercase tracking-[0.3em] text-text-muted font-bold ml-[0.3em]">
            Capture Moment
          </p>
        </div>

        {/* Contributor Label */}
        <div className="absolute bottom-6 flex items-center space-x-2">
          <div className="w-1 h-1 bg-accent rounded-full" />
          <p className="text-[9px] uppercase tracking-widest text-accent font-bold opacity-60 italic">Contributor: {contributor.nickname}</p>
        </div>
      </div>
    </div>
  );
}
