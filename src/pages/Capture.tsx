import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, onSnapshot, updateDoc, increment, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db, logFirestoreError, OperationType } from "../lib/firebase";
import { uploadPhoto } from "../lib/supabase";
import { Gallery, Contributor } from "../types";
import PageWrapper from "../components/PageWrapper";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { motion, AnimatePresence } from "motion/react";
import { LogOut, Zap, ZapOff, SwitchCamera, Camera } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Capture() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [contributor, setContributor] = useState<Contributor | null>(null);
  const [loading, setLoading] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLandscape, setPreviewLandscape] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flashEnabled, setFlashEnabled] = useState(true);
  const [hasTorch, setHasTorch] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [flashEffect, setFlashEffect] = useState(false);
  const [paused, setPaused] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!id) return;
    mountedRef.current = true;
    const contributorId = localStorage.getItem(`contributor_${id}`);
    if (!contributorId) {
      navigate(`/join/${id}`);
      return;
    }

    const unsubG = onSnapshot(doc(db, "galleries", id), (docSnap) => {
      if (docSnap.exists()) {
        const g = { id: docSnap.id, ...docSnap.data() } as Gallery;
        setGallery(g);
        if (g.status === 'revealed' || g.revealAt.toDate() <= new Date()) {
          navigate(`/gallery/${id}`);
        }
      }
    }, (error) => {
      logFirestoreError(error, OperationType.GET, `galleries/${id}`);
    });

    const unsubC = onSnapshot(doc(db, "galleries", id, "contributors", contributorId), (docSnap) => {
      if (docSnap.exists()) {
        setContributor({ id: docSnap.id, ...docSnap.data() } as Contributor);
        setLoading(false);
      } else {
        navigate(`/join/${id}`);
      }
    }, (error) => {
      logFirestoreError(error, OperationType.GET, `galleries/${id}/contributors/${contributorId}`);
    });

    // Check for multiple cameras
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const videoInputs = devices.filter(d => d.kind === "videoinput");
      setHasMultipleCameras(videoInputs.length > 1);
    }).catch(() => {});

    startCamera("environment");

    return () => {
      mountedRef.current = false;
      unsubG();
      unsubC();
      stopCamera();
    };
  }, [id]);

  // Release the camera once the guest has used all their shots.
  useEffect(() => {
    if (gallery && contributor && contributor.shotsTaken >= gallery.maxShots) {
      stopCamera();
    }
  }, [gallery, contributor]);

  const startCamera = async (facing: "environment" | "user") => {
    // Stop existing stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: false
      });
      // Component may have unmounted while getUserMedia was pending.
      if (!mountedRef.current) {
        s.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = s;
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        // Explicitly play for iOS Safari reliability
        videoRef.current.play().catch(e => console.error("Video play failed:", e));
      }
      // Feature-detect torch / flashlight support (only available on rear camera)
      try {
        const track = s.getVideoTracks()[0];
        const caps = track.getCapabilities?.() as any;
        setHasTorch(caps?.torch === true);
      } catch {
        setHasTorch(false);
      }
    } catch (err) {
      console.error("Camera access denied", err);
      setError("Please enable camera access to take photos.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setStream(null);
  };

  const toggleFlash = () => {
    setFlashEnabled(!flashEnabled);
  };

  const flipCamera = () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startCamera(next);
  };

  /** Fire a brief flash pulse using the device torch. */
  const fireFlash = async (): Promise<void> => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;

    try {
      // Turn torch on
      await track.applyConstraints({ advanced: [{ torch: true } as any] });
      // Wait for the flash to illuminate the scene (0.5s longer than 150ms is 650ms)
      await new Promise(r => setTimeout(r, 650));
    } catch {
      // Torch not available — fall through silently
    }
  };

  const endFlash = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: false } as any] });
    } catch {}
  };

  const pauseCamera = () => {
    stopCamera();
    setPaused(true);
  };

  const resumeCamera = () => {
    setPaused(false);
    startCamera(facingMode);
  };

  const takePhoto = async () => {
    if (!videoRef.current || !canvasRef.current || !gallery || !contributor || capturing) return;
    if (contributor.shotsTaken >= gallery.maxShots) return;

    setCapturing(true);
    setError(null);
    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Fire flash if enabled and torch is supported
    const shouldFlash = hasTorch && flashEnabled;
    if (shouldFlash) {
      await fireFlash();
    }

    // Show white flash overlay
    setFlashEffect(true);
    setTimeout(() => setFlashEffect(false), 150);

    const MAX_DIM = 4096;

    let width = video.videoWidth || 640;
    let height = video.videoHeight || 480;

    // Detect device orientation — if device is landscape but video is portrait, rotate
    const orientAngle = (window.screen?.orientation?.angle) ?? 0;
    const isDeviceLandscape = orientAngle === 90 || orientAngle === 270;
    const isVideoPortrait = height > width;
    const shouldRotate = isDeviceLandscape && isVideoPortrait;

    // For rotation, swap the effective dimensions
    let effectiveW = shouldRotate ? height : width;
    let effectiveH = shouldRotate ? width : height;

    if (effectiveW > MAX_DIM || effectiveH > MAX_DIM) {
      if (effectiveW > effectiveH) {
        effectiveH = Math.round((effectiveH * MAX_DIM) / effectiveW);
        effectiveW = MAX_DIM;
      } else {
        effectiveW = Math.round((effectiveW * MAX_DIM) / effectiveH);
        effectiveH = MAX_DIM;
      }
    }

    canvas.width = effectiveW;
    canvas.height = effectiveH;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCapturing(false);
      return;
    }

    if (shouldRotate) {
      // Rotate canvas 90° to produce a landscape image
      const rotDir = orientAngle === 90 ? 1 : -1;
      ctx.translate(effectiveW / 2, effectiveH / 2);
      ctx.rotate((rotDir * Math.PI) / 2);
      ctx.drawImage(video, -effectiveH / 2, -effectiveW / 2, effectiveH, effectiveW);
    } else {
      ctx.drawImage(video, 0, 0, effectiveW, effectiveH);
    }

    // Turn off flash after capture
    if (shouldFlash) {
      endFlash();
    }

    // Generate a preview data URL for the instant polaroid effect
    const previewUrl = canvas.toDataURL("image/jpeg", 0.4);
    setPreviewLandscape(effectiveW > effectiveH);
    setPreview(previewUrl);

    // Convert canvas to a JPEG blob for Supabase upload
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    );

    if (!blob) {
      setError("Failed to capture image. Please try again.");
      setCapturing(false);
      setPreview(null);
      return;
    }

    // Show 2-second preview then upload
    setTimeout(async () => {
      if (!mountedRef.current) return;
      try {
        setPreview(null);

        if (!id || !contributor?.id) {
          setError("Session expired. Please rejoin the gallery.");
          return;
        }

        // Upload to Supabase Storage and get the relative storage path
        const storagePath = await uploadPhoto(blob, id, contributor.id);

        // Save the storage path to Firestore
        await addDoc(collection(db, "galleries", id, "photos"), {
          galleryId: id,
          contributorId: contributor.id,
          storagePath,
          createdAt: serverTimestamp()
        });

        await updateDoc(doc(db, "galleries", id, "contributors", contributor.id), {
          shotsTaken: increment(1)
        });
      } catch (error: any) {
        console.error("Save process failed", error);
        if (!mountedRef.current) return;
        setPreview(null);
        const errorMessage = error?.code === 'permission-denied'
          ? "Permission denied. The gallery may be closed."
          : (error?.message || "Failed to save photo. Please try again.");
        setError(errorMessage);
      } finally {
        if (mountedRef.current) setCapturing(false);
      }
    }, 2000);
  };

  if (loading || !gallery || !contributor) return null;

  const shotsLeft = gallery.maxShots - contributor.shotsTaken;

  // ── All shots used ──
  if (shotsLeft <= 0 && !preview && !capturing) {
    return (
      <PageWrapper>
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-10">
          <Badge label="Reveal Locked" />
          <div className="space-y-4">
            <h2 className="text-4xl font-serif italic text-white/90 leading-tight">Your shots are safe in the vault ✨</h2>
            <p className="text-text-muted text-sm max-w-[280px] mx-auto italic leading-relaxed">
              The camera is closed, the shutter is still. We unlock the secrets soon.
            </p>
          </div>
          <div className="py-8 w-full border-y border-white/5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold mb-4">Reveal Countdown</p>
            <p className="text-5xl font-serif italic text-accent tracking-tight">
              {formatDistanceToNow(gallery.revealAt.toDate(), { addSuffix: true })}
            </p>
          </div>

          <p className="text-xs text-zinc-800 font-bold uppercase tracking-widest">
            See you on the other side.
          </p>
        </div>
      </PageWrapper>
    );
  }

  // ── Paused / Waiting lobby ──
  if (paused) {
    return (
      <PageWrapper>
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center space-y-10"
          >
            <motion.div
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <Badge label="Camera Paused" />
            </motion.div>

            <div className="space-y-4">
              <h2 className="text-4xl font-serif italic text-white/90 leading-tight">
                {gallery.title}
              </h2>
              <p className="text-text-muted text-sm max-w-[280px] mx-auto italic leading-relaxed">
                Take a break. Your shots will be waiting for you when you're ready.
              </p>
            </div>

            {/* Shots info */}
            <div className="py-6 w-full max-w-xs border-y border-white/5 space-y-5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold mb-2">Shots Remaining</p>
                <p className="text-3xl font-serif italic text-accent tracking-tight">
                  {shotsLeft} <span className="text-lg text-white/30">/ {gallery.maxShots}</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold mb-2">Reveal Countdown</p>
                <p className="text-3xl font-serif italic text-accent tracking-tight">
                  {formatDistanceToNow(gallery.revealAt.toDate(), { addSuffix: true })}
                </p>
              </div>
            </div>

            {/* Resume button */}
            <Button onClick={resumeCamera}>
              <Camera size={18} />
              <span>Resume Camera</span>
            </Button>

            <p className="text-[10px] text-zinc-700 uppercase tracking-widest font-bold">
              Contributor: {contributor.nickname}
            </p>
          </motion.div>
        </div>
      </PageWrapper>
    );
  }

  return (
    <div className="fixed inset-0 h-[100dvh] w-full bg-black z-50 touch-none select-none overflow-hidden">
      {/* Viewport */}
      <div className="absolute inset-0 bg-black flex items-center justify-center">
        {/* Flash white overlay */}
        <AnimatePresence>
          {flashEffect && (
            <motion.div
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 z-50 bg-white pointer-events-none"
            />
          )}
        </AnimatePresence>

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
            <button onClick={() => { setError(null); startCamera(facingMode); }} className="px-6 py-3 bg-white text-black rounded-full font-bold">Try Again</button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
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
                  <img src={preview} className={`${previewLandscape ? 'w-[85vw] aspect-[4/3]' : 'w-[75vw] aspect-[3/4]'} object-cover rounded-sm`} />
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

          <div className="flex items-center space-x-3 pointer-events-auto">
            {/* Flash toggle — only shown on supported devices */}
            {hasTorch && (
              <button
                onClick={toggleFlash}
                className={`w-12 h-12 backdrop-blur-xl rounded-full border flex items-center justify-center active:scale-90 transition-all ${
                  flashEnabled
                    ? 'bg-accent/20 border-accent/40 text-accent'
                    : 'bg-black/40 border-white/10 text-white/60'
                }`}
              >
                {flashEnabled ? <Zap size={18} /> : <ZapOff size={18} />}
              </button>
            )}
            <button
              onClick={pauseCamera}
              className="w-12 h-12 bg-black/40 backdrop-blur-xl rounded-full border border-white/10 flex items-center justify-center active:scale-90 transition-transform"
            >
              <LogOut size={18} className="text-white/60" />
            </button>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Shutter Bar Overlay */}
      <div className="absolute bottom-0 inset-x-0 h-[220px] flex flex-col items-center justify-center z-30 pointer-events-none bg-gradient-to-t from-black/80 via-black/40 to-transparent">
        <div className="flex items-center justify-center space-x-8 pointer-events-auto">
          {/* Flip camera button */}
          {hasMultipleCameras ? (
            <button
              onClick={flipCamera}
              disabled={!!preview || capturing}
              className="w-14 h-14 bg-white/5 backdrop-blur-xl rounded-full border border-white/10 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-20"
            >
              <SwitchCamera size={20} className="text-white/60" />
            </button>
          ) : (
            <div className="w-14" /> /* spacer */
          )}

          {/* Shutter button */}
          <div className="flex flex-col items-center space-y-3">
            <button
              disabled={!!preview || capturing || shotsLeft <= 0}
              onClick={takePhoto}
              className="group relative w-20 h-20 rounded-full border-[3px] border-white/20 p-1.5 active:scale-95 transition-transform disabled:opacity-10"
            >
              <div className="w-full h-full bg-white rounded-full transition-all group-active:scale-90 group-active:bg-accent" />
              <div className="absolute -inset-4 border border-accent/0 rounded-full group-active:border-accent/40 group-active:scale-110 transition-all duration-500" />
            </button>
            <p className="text-[10px] uppercase tracking-[0.3em] text-text-muted font-bold ml-[0.3em]">
              Capture
            </p>
          </div>

          {/* Spacer for symmetry */}
          <div className="w-14" />
        </div>

        {/* Contributor Label */}
        <div className="absolute bottom-6 flex items-center space-x-2 pointer-events-auto">
          <div className="w-1 h-1 bg-accent rounded-full" />
          <p className="text-[9px] uppercase tracking-widest text-accent font-bold opacity-60 italic">Contributor: {contributor.nickname}</p>
        </div>
      </div>
    </div>
  );
}
