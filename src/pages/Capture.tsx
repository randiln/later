import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, onSnapshot, increment, collection, serverTimestamp, writeBatch } from "firebase/firestore";
import { db, logFirestoreError, OperationType } from "../lib/firebase";
import { newPhotoPath, uploadJpeg } from "../lib/supabase";
import { computeRenderParams, renderPreviewCanvas, variantPath } from "../lib/imageProcessing";
import { cameraConstraints, describeTrack, grabFrame, pickBestSource, prepareStillCapture, takeStillPhoto } from "../lib/camera";
import { encodePhotoInBackground, warmUpPhotoEncoder } from "../lib/photoEncoder";
import { PhotoUploadQueue, QueuedPhoto, QueueState } from "../lib/uploadQueue";
import { Gallery, Contributor, GalleryNotificationSettings } from "../types";
import { isHostFirst } from "../lib/gallery";
import PageWrapper from "../components/PageWrapper";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { motion, AnimatePresence } from "motion/react";
import { LogOut, Zap, ZapOff, SwitchCamera, Camera, HelpCircle, CloudUpload } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import TutorialPopup from "../components/TutorialPopup";
import NotificationPrompt from "../components/NotificationPrompt";
import {
  canNotify,
  getPermissionStatus,
  registerServiceWorker,
  requestNotificationPermission,
  scheduleReminders,
  notifyPhotoTaken,
  notifyPageVisible,
  cancelReminders,
  isIOS,
  isPWA,
} from "../lib/notifications";

/** Defaults the service worker assumes when a gallery has no notification settings. */
const DEFAULT_NOTIFICATION_SETTINGS: GalleryNotificationSettings = {
  enabled: true,
  inactivityInterval: 10,
  recurrentInactivity: false,
  beforeEndReminder: 5,
  notifyOnReveal: true,
};

/** How long the polaroid stays up before the camera is ready again (tap to dismiss sooner). */
const SHOT_PREVIEW_MS = 1300;

/** Private-reveal galleries aren't viewable at reveal time, so skip the "vault is open" notification. */
function reminderSettings(gallery: Gallery): GalleryNotificationSettings | undefined {
  if (!isHostFirst(gallery)) return gallery.notificationSettings;
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...gallery.notificationSettings, notifyOnReveal: false };
}

export default function Capture() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [contributor, setContributor] = useState<Contributor | null>(null);
  const [loading, setLoading] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  /** The polaroid currently shown after a shot. */
  const [shot, setShot] = useState<{ canvas: HTMLCanvasElement; landscape: boolean; number: number } | null>(null);
  /** True only while the frame is being grabbed (a few ms); blocks double taps. */
  const [busy, setBusy] = useState(false);
  /** Shots taken this visit (plus leftovers from a previous visit not yet counted by the server). */
  const [sessionShots, setSessionShots] = useState(0);
  const [queueState, setQueueState] = useState<QueueState>({ queued: 0, retrying: false });
  /** Shots grabbed but still being encoded (not yet in the upload queue). */
  const [encoding, setEncoding] = useState(0);
  /** `?camdebug` in the URL shows stream resolution, live fps and the last shot's source. */
  const [camDebug] = useState(() => new URLSearchParams(window.location.search).has("camdebug"));
  const [camInfo, setCamInfo] = useState("");
  const [camFps, setCamFps] = useState<number | null>(null);
  const [lastShotInfo, setLastShotInfo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [flashEffect, setFlashEffect] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);
  const notifScheduled = useRef(false);
  const reminderCount = useRef(0);

  // Orientation states & logic
  const [deviceOrientationAngle, setDeviceOrientationAngle] = useState<number>(0);
  const [viewportOrientationAngle, setViewportOrientationAngle] = useState<number>(0);
  const hasAccelerometerFired = useRef(false);

  const updateViewportOrientation = useCallback(() => {
    let orientAngle = 0;
    if (window.screen?.orientation) {
      orientAngle = window.screen.orientation.angle ?? 0;
    } else if (typeof window.orientation === 'number') {
      const rawAngle = window.orientation;
      if (rawAngle === 90) orientAngle = 270;
      else if (rawAngle === -90 || rawAngle === 270) orientAngle = 90;
      else orientAngle = rawAngle;
    }
    const normAngle = ((orientAngle % 360) + 360) % 360;
    setViewportOrientationAngle(normAngle);

    // Initial fallback: if accelerometer hasn't fired yet, follow the viewport
    setDeviceOrientationAngle(prev => {
      if (hasAccelerometerFired.current) return prev;
      return normAngle;
    });
  }, []);

  const handleDeviceOrientation = useCallback((event: DeviceOrientationEvent) => {
    const beta = event.beta;
    const gamma = event.gamma;
    if (beta === null || gamma === null) return;

    hasAccelerometerFired.current = true;
    
    // Check gravity vector magnitude in XY plane to ignore flat orientations
    const magnitude = Math.sqrt(beta * beta + gamma * gamma);
    if (magnitude >= 25) {
      let angle = Math.round(Math.atan2(-gamma, beta) * (180 / Math.PI));
      if (angle < 0) angle += 360;
      const step = (Math.round(angle / 90) * 90) % 360;
      let physicalOrientation = 0;
      if (step === 90) physicalOrientation = 270;
      else if (step === 270) physicalOrientation = 90;
      else physicalOrientation = step;
      
      setDeviceOrientationAngle(physicalOrientation);
    }
  }, []);

  // Listen to viewport orientation changes
  useEffect(() => {
    window.addEventListener("resize", updateViewportOrientation);
    window.addEventListener("orientationchange", updateViewportOrientation);
    updateViewportOrientation();
    return () => {
      window.removeEventListener("resize", updateViewportOrientation);
      window.removeEventListener("orientationchange", updateViewportOrientation);
    };
  }, [updateViewportOrientation]);

  // Request accelerometer permission on first user gesture and set up listener
  useEffect(() => {
    let permissionRequested = false;

    const requestOrientationPermission = async () => {
      if (permissionRequested) return;
      permissionRequested = true;

      if (
        typeof window !== "undefined" &&
        typeof (DeviceOrientationEvent as any) === "function" &&
        typeof (DeviceOrientationEvent as any).requestPermission === "function"
      ) {
        try {
          const permissionState = await (DeviceOrientationEvent as any).requestPermission();
          if (permissionState === "granted") {
            window.addEventListener("deviceorientation", handleDeviceOrientation);
          }
        } catch (err) {
          console.error("Error requesting device orientation permission:", err);
        }
      } else {
        window.addEventListener("deviceorientation", handleDeviceOrientation);
      }
    };

    const handleInteraction = () => {
      requestOrientationPermission();
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
    };

    window.addEventListener("click", handleInteraction);
    window.addEventListener("touchstart", handleInteraction);

    // Also try checking immediately in case permission is already granted or not needed
    if (
      typeof window !== "undefined" &&
      typeof (DeviceOrientationEvent as any) === "function" &&
      typeof (DeviceOrientationEvent as any).requestPermission !== "function"
    ) {
      window.addEventListener("deviceorientation", handleDeviceOrientation);
    }

    return () => {
      window.removeEventListener("click", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
      window.removeEventListener("deviceorientation", handleDeviceOrientation);
    };
  }, [handleDeviceOrientation]);

  // Zoom & Focus states
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(4);
  const [hasNativeZoom, setHasNativeZoom] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [focusActive, setFocusActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const queueRef = useRef<PhotoUploadQueue | null>(null);
  const shotTimerRef = useRef<number | undefined>(undefined);
  /** shotsTaken from the first contributor snapshot of this visit. */
  const baselineTakenRef = useRef<number | null>(null);
  const shotsLeftRef = useRef(0);

  // The <video> only renders once Firestore data has loaded, which can be after
  // getUserMedia resolves. Attach the stream whenever the element (re)mounts.
  const attachVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(e => console.error("Video play failed:", e));
    }
  }, []);

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
        const c = { id: docSnap.id, ...docSnap.data() } as Contributor;
        if (baselineTakenRef.current === null) baselineTakenRef.current = c.shotsTaken;
        setContributor(c);
        setLoading(false);
      } else {
        navigate(`/join/${id}`);
      }
    }, (error) => {
      logFirestoreError(error, OperationType.GET, `galleries/${id}/contributors/${contributorId}`);
    });

    startCamera("environment");

    return () => {
      mountedRef.current = false;
      unsubG();
      unsubC();
      stopCamera();
    };
  }, [id]);

  // The app-wide grain overlay uses a blend mode that is re-composited over every
  // video frame; switch it off while the camera is open.
  useEffect(() => {
    document.documentElement.classList.add("camera-open");
    return () => document.documentElement.classList.remove("camera-open");
  }, []);

  // ?camdebug: count frames actually delivered to the viewfinder.
  useEffect(() => {
    if (!camDebug || !stream) return;
    const video = videoRef.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }) | null;
    if (!video?.requestVideoFrameCallback) return;
    let frames = 0;
    let stopped = false;
    const onFrame = () => {
      frames++;
      if (!stopped) video.requestVideoFrameCallback!(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    const timer = window.setInterval(() => {
      setCamFps(frames);
      frames = 0;
    }, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [camDebug, stream]);

  // Background upload queue: resumes shots left over from a previous visit.
  useEffect(() => {
    if (!id) return;
    warmUpPhotoEncoder();
    const queue = new PhotoUploadQueue({
      galleryId: id,
      upload: uploadJpeg,
      commit: async (item: QueuedPhoto) => {
        // Photo doc + shot increment land together or not at all.
        const batch = writeBatch(db);
        batch.set(doc(db, "galleries", item.galleryId, "photos", item.id), {
          galleryId: item.galleryId,
          contributorId: item.contributorId,
          storagePath: item.storagePath,
          ...(item.done.display ? { displayPath: item.displayPath } : {}),
          ...(item.done.thumb ? { thumbPath: item.thumbPath } : {}),
          width: item.width,
          height: item.height,
          createdAt: serverTimestamp(),
        });
        batch.update(doc(db, "galleries", item.galleryId, "contributors", item.contributorId), {
          shotsTaken: increment(1),
        });
        try {
          await batch.commit();
        } catch (err: any) {
          logFirestoreError(err, OperationType.WRITE, `galleries/${item.galleryId}/photos/${item.id}`);
          if (err?.code === "permission-denied") {
            throw Object.assign(new Error("A photo couldn't be saved because the event has closed."), { code: err.code });
          }
          throw err;
        }
      },
      onChange: (state) => { if (mountedRef.current) setQueueState(state); },
      onSaved: () => {
        // Notify SW: photo taken, update shot count, reset inactivity timer
        notifyPhotoTaken(id, shotsLeftRef.current);
        reminderCount.current = 0;
        if (shotsLeftRef.current <= 0) cancelReminders(id);
      },
      onFailed: (_item, message) => {
        if (!mountedRef.current) return;
        setSessionShots((n) => n - 1);
        setError(message);
      },
    });
    queueRef.current = queue;
    let active = true;
    queue.start().then((uncounted) => {
      if (uncounted && active) setSessionShots((n) => n + uncounted);
    });
    return () => {
      active = false;
      queue.stop();
      queueRef.current = null;
      window.clearTimeout(shotTimerRef.current);
    };
  }, [id]);

  // Warn before leaving while photos are still being saved.
  const unsaved = queueState.queued + encoding;
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  // Check if tutorial has been seen yet, only after data finishes loading
  useEffect(() => {
    if (loading || !gallery || !id) return;
    const seen = localStorage.getItem(`later_tutorial_seen_${id}`);
    if (!seen) {
      setShowTutorial(true);
    }
  }, [loading, gallery, id]);

  const handleCloseTutorial = () => {
    if (id) {
      localStorage.setItem(`later_tutorial_seen_${id}`, "true");
    }
    setShowTutorial(false);

    // Check notification prompt eligibility after tutorial closes
    maybeShowNotifPrompt();
  };

  function maybeShowNotifPrompt() {
    const isIosBrowser = isIOS() && !isPWA();
    
    if (!isIosBrowser) {
      if (!canNotify()) return;
      if (getPermissionStatus() !== 'default') return;
    }

    const prompted = localStorage.getItem(`later_notif_prompted_${id}`);
    if (prompted) return;
    setTimeout(() => setShowNotifPrompt(true), 600);
  }

  // Show notification prompt independently of tutorial on subsequent visits
  useEffect(() => {
    if (loading || !gallery || !id) return;
    const tutorialSeen = localStorage.getItem(`later_tutorial_seen_${id}`);
    if (!tutorialSeen) return; // tutorial will trigger it via handleCloseTutorial
    maybeShowNotifPrompt();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, gallery, id]);

  // Register SW + auto-schedule if permission already granted
  useEffect(() => {
    if (!gallery || !contributor || !id || notifScheduled.current) return;

    registerServiceWorker().then(() => {
      if (getPermissionStatus() === 'granted') {
        const shotsLeft = gallery.maxShots - contributor.shotsTaken;
        if (shotsLeft > 0) {
          const baseUrl = window.location.origin;
          scheduleReminders(
            id,
            gallery.title,
            shotsLeft,
            gallery.revealAt.toDate(),
            `${baseUrl}/capture/${id}`,
            `${baseUrl}/gallery/${id}`,
            reminderCount.current,
            reminderSettings(gallery),
          );
          notifScheduled.current = true;
        }
      }
    });
  }, [gallery, contributor, id]);

  // Visibilitychange — the key to reliable notifications:
  // Tell the SW to start the inactivity timer when user backgrounds the tab,
  // and cancel it when they return.
  useEffect(() => {
    if (!gallery || !contributor || !id) return;
    if (getPermissionStatus() !== 'granted') return;

    const onVisibilityChange = () => {
      const shotsLeft = gallery.maxShots - contributor.shotsTaken;
      if (document.visibilityState === 'hidden') {
        if (shotsLeft > 0) {
          const baseUrl = window.location.origin;
          scheduleReminders(
            id,
            gallery.title,
            shotsLeft,
            gallery.revealAt.toDate(),
            `${baseUrl}/capture/${id}`,
            `${baseUrl}/gallery/${id}`,
            reminderCount.current,
            reminderSettings(gallery),
          );
        }
      } else {
        // User came back — cancel inactivity timers
        notifyPageVisible(id);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [gallery, contributor, id]);

  const handleNotifAccept = async () => {
    setShowNotifPrompt(false);
    if (id) localStorage.setItem(`later_notif_prompted_${id}`, 'true');

    const granted = await requestNotificationPermission();
    if (granted && gallery && contributor && id) {
      const shotsLeft = gallery.maxShots - contributor.shotsTaken;
      if (shotsLeft > 0) {
        const baseUrl = window.location.origin;
        await registerServiceWorker();
        scheduleReminders(
          id,
          gallery.title,
          shotsLeft,
          gallery.revealAt.toDate(),
          `${baseUrl}/capture/${id}`,
          `${baseUrl}/gallery/${id}`,
          reminderCount.current,
          reminderSettings(gallery),
        );
        notifScheduled.current = true;
      }
    }
  };

  const handleNotifDismiss = () => {
    setShowNotifPrompt(false);
    if (id) localStorage.setItem(`later_notif_prompted_${id}`, 'true');
  };

  // Shots used counts the ones still uploading, so the guest can't overshoot while offline.
  const shotsTaken = contributor
    ? Math.max(contributor.shotsTaken, (baselineTakenRef.current ?? contributor.shotsTaken) + sessionShots)
    : 0;
  const shotsLeft = gallery ? Math.max(0, gallery.maxShots - shotsTaken) : 0;
  shotsLeftRef.current = shotsLeft;

  // Release the camera once the guest has used all their shots (after the last polaroid).
  useEffect(() => {
    if (gallery && contributor && shotsLeft <= 0 && !shot && !busy) {
      stopCamera();
      // Cancel notifications when all shots are used
      if (id) cancelReminders(id);
    }
  }, [gallery, contributor, shotsLeft, shot, busy]);

  const startCamera = async (facing: "environment" | "user") => {
    // Reset zoom state on new camera stream initialization
    setZoom(1);

    // Stop existing stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: cameraConstraints(facing),
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
      const videoTrack = s.getVideoTracks()[0];
      prepareStillCapture(videoTrack);
      setCamInfo(describeTrack(videoTrack));
      console.log("Camera stream:", videoTrack?.getSettings());
      // Check for multiple cameras now that camera permission has been granted
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const videoInputs = devices.filter(d => d.kind === "videoinput");
        setHasMultipleCameras(videoInputs.length > 1);
      }).catch(() => {});
      // Feature-detect camera capabilities (torch, native zoom)
      try {
        const track = s.getVideoTracks()[0];
        const caps = track.getCapabilities?.() as any;
        setHasTorch(caps?.torch === true);
        
        if (caps?.zoom) {
          setHasNativeZoom(true);
          setMaxZoom(caps.zoom.max || 4);
        } else {
          setHasNativeZoom(false);
          setMaxZoom(4);
        }
      } catch {
        setHasTorch(false);
        setHasNativeZoom(false);
        setMaxZoom(4);
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

  const handleZoomChange = async (value: number) => {
    setZoom(value);
    if (hasNativeZoom && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        try {
          await track.applyConstraints({
            advanced: [{ zoom: value } as any]
          });
        } catch (e) {
          console.error("Failed to apply native zoom:", e);
        }
      }
    }
  };

  const handleViewfinderTap = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    // Do not trigger focus ring if clicking on overlay control buttons
    if ((e.target as HTMLElement).closest("button")) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setFocusPoint({ x, y });
    setFocusActive(true);

    // Fade out focus ring
    setTimeout(() => {
      setFocusActive(false);
    }, 1000);

    try {
      const caps = track.getCapabilities?.() as any;
      if (caps?.focusMode?.includes('single-shot')) {
        const pointX = x / rect.width;
        const pointY = y / rect.height;
        await track.applyConstraints({
          advanced: [{
            focusMode: 'single-shot',
            pointsOfInterest: [{ x: pointX, y: pointY }]
          } as any]
        });
      }
    } catch (err) {
      console.warn("Focus constraints failed:", err);
    }
  };

  const dismissShot = () => {
    window.clearTimeout(shotTimerRef.current);
    setShot(null);
  };

  /**
   * Shutter. Only the frame grab and a small preview are on the critical path
   * (~100 ms): full-size encoding runs in a worker and uploading in the background
   * queue, so the camera is ready again as soon as the polaroid is dismissed.
   */
  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video || !gallery || !contributor || !id || busy || shot) return;
    if (shotsLeft <= 0) return;
    if (video.readyState < 2 || !video.videoWidth) {
      setError("The camera is still starting. Try again in a second.");
      return;
    }

    setBusy(true);
    setError(null);
    navigator.vibrate?.(12);

    // Fire flash if enabled and torch is supported
    const shouldFlash = hasTorch && flashEnabled;
    let reserved = false;
    try {
      if (shouldFlash) await fireFlash();

      // Show white flash overlay at the moment of capture
      setFlashEffect(true);
      setTimeout(() => setFlashEffect(false), 150);

      // The viewfinder frame is the moment the guest saw: grab it first, instantly.
      const frame = await grabFrame(video);
      if (shouldFlash) endFlash();

      // Meanwhile ask for the full-resolution still (Chrome). It never delays the UI:
      // the polaroid uses the frame, and the saved photo falls back to it if the still is slow.
      const track = streamRef.current?.getVideoTracks()[0];
      const stillStartedAt = performance.now();
      const still = !shouldFlash && track ? takeStillPhoto(track) : Promise.resolve(null);

      // Counts against shots left immediately, before anything is uploaded.
      setSessionShots((n) => n + 1);
      reserved = true;
      const shotNumber = shotsTaken + 1;
      const zoomRatio = hasNativeZoom ? 1 : zoom;
      const angle = deviceOrientationAngle;
      const previewParams = computeRenderParams(frame.width, frame.height, zoomRatio, angle);

      // Instant polaroid: draw the frame into a small on-screen canvas (no encoding).
      if (mountedRef.current) {
        setShot({ canvas: renderPreviewCanvas(frame.bitmap, previewParams, 900), landscape: previewParams.outW > previewParams.outH, number: shotNumber });
        window.clearTimeout(shotTimerRef.current);
        shotTimerRef.current = window.setTimeout(dismissShot, SHOT_PREVIEW_MS);
      }
      setBusy(false);

      setEncoding((n) => n + 1);
      const contributorId = contributor.id;
      pickBestSource(frame, still)
        .then(({ source, usedStill }) => {
          // Some devices pause the viewfinder during a still capture.
          if (video.paused) video.play().catch(() => {});
          const params = computeRenderParams(source.width, source.height, zoomRatio, angle);
          const info = `${usedStill ? "still" : "frame"} ${params.outW}×${params.outH}` +
            (usedStill ? ` in ${Math.round(performance.now() - stillStartedAt)}ms` : "");
          console.log("Photo capture diagnostics:", { source: info, deviceOrientationAngle: angle, rotate: params.rotate, zoom, hasNativeZoom });
          if (mountedRef.current) setLastShotInfo(info);
          return encodePhotoInBackground(source.bitmap, params);
        })
        .then((encoded) => {
          const storagePath = newPhotoPath(id, contributorId);
          // Same tick as the queue's own update, so the saving count doesn't flicker.
          setEncoding((n) => n - 1);
          return queueRef.current?.enqueue({
            id: doc(collection(db, "galleries", id, "photos")).id,
            galleryId: id,
            contributorId,
            storagePath,
            displayPath: variantPath(storagePath, "display"),
            thumbPath: variantPath(storagePath, "thumb"),
            original: encoded.original,
            display: encoded.display,
            thumb: encoded.thumb,
            width: encoded.width,
            height: encoded.height,
            createdAt: Date.now(),
            done: {},
            attempts: 0,
          });
        })
        .catch((err) => {
          console.error("Photo encoding failed", err);
          setEncoding((n) => Math.max(0, n - 1));
          setSessionShots((n) => n - 1);
          if (mountedRef.current) setError("That photo couldn't be processed. Please take it again.");
        });
    } catch (err) {
      console.error("Capture failed", err);
      if (shouldFlash) endFlash();
      if (reserved) setSessionShots((n) => n - 1);
      setBusy(false);
      setError("Couldn't take the photo. Please try again.");
    }
  };

  if (loading || !gallery || !contributor) return null;

  const savingLabel = unsaved > 0
    ? queueState.retrying
      ? `Waiting for signal · ${unsaved} safe on this phone`
      : `Saving ${unsaved}`
    : null;

  // ── All shots used ──
  if (shotsLeft <= 0 && !shot && !busy) {
    return (
      <PageWrapper>
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-10">
          <Badge label="Reveal Locked" />
          <div className="space-y-4">
            <h2 className="text-4xl font-serif italic text-white/90 leading-tight">
              {unsaved > 0 ? "Developing your last shots…" : "Your shots are safe in the vault ✨"}
            </h2>
            <p className="text-text-muted text-sm max-w-[280px] mx-auto italic leading-relaxed">
              {unsaved > 0
                ? queueState.retrying
                  ? `Waiting for signal. ${unsaved} ${unsaved === 1 ? "photo is" : "photos are"} safe on this phone — keep this page open.`
                  : `Saving ${unsaved} ${unsaved === 1 ? "photo" : "photos"}. Keep this page open for a moment.`
                : "The camera is closed, the shutter is still. We unlock the secrets soon."}
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

  const isViewportLandscape = window.innerWidth > window.innerHeight;
  const rotation = isViewportLandscape ? (viewportOrientationAngle === 270 ? -90 : viewportOrientationAngle === 90 ? 90 : 0) : 0;
  const isLandscape = deviceOrientationAngle === 90 || deviceOrientationAngle === 270;

  const innerContainerStyle: React.CSSProperties = isViewportLandscape ? {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: '100dvh',
    height: '100dvw',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    transformOrigin: 'center center',
  } : {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  };

  const iconStyle: React.CSSProperties = {
    transform: `rotate(${-deviceOrientationAngle}deg)`,
    transition: 'transform 0.3s ease-in-out',
  };

  return (
    <div className="fixed inset-0 h-[100dvh] w-full bg-black z-50 touch-none select-none overflow-hidden">
      <div style={innerContainerStyle} className="absolute inset-0 overflow-hidden">
        {/* Viewport */}
        <div
          onClick={handleViewfinderTap}
          className="absolute inset-0 bg-black flex items-center justify-center cursor-pointer"
        >
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
            <div className="absolute top-24 inset-x-4 z-40 bg-red-950/95 border border-red-500/30 rounded-2xl p-4 flex items-start space-x-3 pointer-events-auto">
              <p className="text-red-300 text-xs flex-1 leading-relaxed">{error}</p>
              <button onClick={() => setError(null)} className="text-red-400 text-xs font-bold uppercase tracking-widest shrink-0">Dismiss</button>
            </div>
          )}
          {/* Camera access error - full screen */}
          {error && !stream ? (
            <div className="p-10 text-center space-y-4 pointer-events-auto">
              <p className="text-text-muted">{error}</p>
              <button onClick={() => { setError(null); startCamera(facingMode); }} className="px-6 py-3 bg-white text-black rounded-full font-bold">Try Again</button>
            </div>
          ) : (
            <video
              ref={attachVideoRef}
              autoPlay
              playsInline
              muted
              style={{
                transform: `scale(${!hasNativeZoom ? zoom : 1}) ${facingMode === 'user' ? 'scaleX(-1)' : ''}`,
                transition: 'transform 0.25s ease-out'
              }}
              className="w-full h-full object-cover"
            />
          )}

          {/* Camera Grid */}
          {!shot && (
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="border-[0.5px] border-white/10" />
              ))}
            </div>
          )}

          {/* Focus Ring Overlay */}
          <AnimatePresence>
            {focusActive && focusPoint && (
              <motion.div
                initial={{ scale: 1.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                style={{
                  position: "absolute",
                  left: focusPoint.x - 30,
                  top: focusPoint.y - 30,
                  width: 60,
                  height: 60,
                }}
                className="border-2 border-accent rounded-full pointer-events-none z-40 flex items-center justify-center"
              >
                <div className="w-1.5 h-1.5 bg-accent rounded-full animate-ping" />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Polaroid — pops in after the flash, then flies off toward the shot counter */}
          <AnimatePresence>
            {shot && (
              <motion.div
                key={shot.number}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.35 } }}
                onClick={(e) => { e.stopPropagation(); dismissShot(); }}
                className="absolute inset-0 z-20 flex items-center justify-center bg-black/50"
              >
                <div style={iconStyle}>
                <motion.div
                  initial={{ y: 60, scale: 0.85, rotate: -5, opacity: 0 }}
                  animate={{ y: 0, scale: 1, rotate: -1.5, opacity: 1 }}
                  exit={{ y: -320, x: -120, scale: 0.15, rotate: -14, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 24 }}
                  className="p-2.5 pb-9 bg-[#f6f1e7] rounded-[3px] shadow-2xl relative"
                >
                  <motion.div
                    ref={(el) => { if (el && el.firstChild !== shot.canvas) el.replaceChildren(shot.canvas); }}
                    initial={{ filter: "brightness(0.15) sepia(0.9) contrast(0.7)" }}
                    animate={{ filter: "brightness(1) sepia(0) contrast(1)" }}
                    transition={{ duration: 1.1, ease: "easeOut" }}
                    className={`${shot.landscape ? 'w-[78vw] max-w-[440px] aspect-[4/3]' : 'w-[64vw] max-w-[340px] aspect-[3/4]'} overflow-hidden bg-black [&>canvas]:w-full [&>canvas]:h-full [&>canvas]:object-cover`}
                    data-polaroid
                  />
                  <p className="absolute bottom-2.5 inset-x-0 text-center font-serif italic text-[13px] text-zinc-500">
                    Shot {shot.number} of {gallery.maxShots}
                  </p>
                </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {camDebug && (
            <div className="absolute top-2 inset-x-0 z-40 flex justify-center pointer-events-none">
              <p className="bg-black/70 text-[10px] font-mono text-white/80 px-2 py-1 rounded">
                {camInfo} · live {camFps ?? "?"}fps{lastShotInfo && ` · last: ${lastShotInfo}`}
              </p>
            </div>
          )}

          {/* UI Overlays */}
          <div className="absolute top-0 inset-x-0 p-8 flex justify-between items-start pointer-events-none z-30">
            <div className="flex items-center space-x-3 pointer-events-auto">
              {hasMultipleCameras && (
                <button
                  onClick={flipCamera}
                  disabled={busy || !!shot}
                  className="w-12 h-12 bg-black/55 rounded-full border border-white/10 flex items-center justify-center active:scale-90 transition-transform disabled:opacity-20"
                >
                  <SwitchCamera size={18} className="text-white/60" style={iconStyle} />
                </button>
              )}
              {!isLandscape && (
                <div className="flex flex-col items-start gap-2" style={iconStyle}>
                  <div className="bg-black/55 px-4 py-2.5 rounded-2xl border border-white/10">
                    <p className="text-[9px] uppercase tracking-[0.2em] text-white/40 font-bold">Shots Remaining</p>
                    <p className="text-xl font-serif italic text-accent leading-none mt-1.5">{shotsLeft} / {gallery.maxShots}</p>
                  </div>
                  <SavingPill label={savingLabel} retrying={queueState.retrying} />
                </div>
              )}
            </div>

            <div className="flex items-center space-x-3 pointer-events-auto">
              <button
                onClick={() => setShowTutorial(true)}
                className="w-12 h-12 bg-black/55 rounded-full border border-white/10 flex items-center justify-center active:scale-90 transition-transform"
              >
                <HelpCircle size={18} className="text-white/60" style={iconStyle} />
              </button>
              {/* Flash toggle — only shown on supported devices */}
              {hasTorch && (
                <button
                  onClick={toggleFlash}
                  className={`w-12 h-12 rounded-full border flex items-center justify-center active:scale-90 transition-all ${
                    flashEnabled
                      ? 'bg-accent/20 border-accent/40 text-accent'
                      : 'bg-black/55 border-white/10 text-white/60'
                  }`}
                >
                  <div style={iconStyle}>
                    {flashEnabled ? <Zap size={18} /> : <ZapOff size={18} />}
                  </div>
                </button>
              )}
              <button
                onClick={pauseCamera}
                className="w-12 h-12 bg-black/55 rounded-full border border-white/10 flex items-center justify-center active:scale-90 transition-transform"
              >
                <LogOut size={18} className="text-white/60" style={iconStyle} />
              </button>
            </div>
          </div>
        </div>

        {/* Shutter Bar Overlay */}
        <div className="absolute bottom-0 inset-x-0 h-[220px] flex flex-col items-center justify-center z-30 pointer-events-none bg-gradient-to-t from-black/80 via-black/40 to-transparent">
          {/* Zoom controls */}
          {maxZoom > 1 && (
            <div className="flex items-center justify-center space-x-4 mb-4 pointer-events-auto">
              {[1, 2, 4].filter(z => z <= maxZoom).map((z) => (
                <button
                  key={z}
                  onClick={() => handleZoomChange(z)}
                  className={`w-9 h-9 rounded-full border text-[10px] font-bold flex items-center justify-center transition-all ${
                    zoom === z
                      ? 'bg-accent border-accent text-black scale-110'
                      : 'bg-black/60 border-white/20 text-white/80 active:scale-95'
                  }`}
                  style={iconStyle}
                >
                  {z}x
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-center pointer-events-auto">
            {/* Shutter button */}
            <div className="flex flex-col items-center">
              <button
                disabled={busy || !!shot || shotsLeft <= 0}
                onClick={takePhoto}
                className="group relative w-20 h-20 rounded-full border-[3px] border-white/20 p-1.5 active:scale-95 transition-transform disabled:opacity-10"
              >
                <div className="w-full h-full bg-white rounded-full transition-all group-active:scale-90 group-active:bg-accent" />
                <div className="absolute -inset-4 border border-accent/0 rounded-full group-active:border-accent/40 group-active:scale-110 transition-all duration-500" />
              </button>
            </div>
          </div>

          {/* Contributor Label — only shown in portrait */}
          {!isLandscape && (
            <div className="absolute bottom-6 flex items-center space-x-2 pointer-events-auto" style={iconStyle}>
              <div className="w-1 h-1 bg-accent rounded-full" />
              <p className="text-[9px] uppercase tracking-widest text-accent font-bold opacity-60 italic">Contributor: {contributor.nickname}</p>
            </div>
          )}
        </div>

        {/* Landscape Overlays */}
        {isLandscape && (
          <div className="absolute inset-0 pointer-events-none z-30 flex items-center justify-center">
            <div
              className="pointer-events-auto flex items-center space-x-3 shadow-2xl"
              style={{
                transform: `rotate(${-deviceOrientationAngle}deg) translateY(calc(50vmin - 48px))`,
                transition: 'transform 0.3s ease-in-out',
              }}
            >
              {/* Contributor Label */}
              <div className="bg-black/55 px-4 py-2.5 rounded-2xl border border-white/10 flex items-center space-x-2">
                <div className="w-1.5 h-1.5 bg-accent rounded-full" />
                <p className="text-[9px] uppercase tracking-widest text-accent font-bold opacity-80 italic">
                  Contributor: {contributor.nickname}
                </p>
              </div>

              {/* Shots Remaining */}
              <div className="bg-black/55 px-4 py-2.5 rounded-2xl border border-white/10 flex items-center space-x-3">
                <p className="text-[9px] uppercase tracking-[0.2em] text-white/40 font-bold">Shots Remaining</p>
                <p className="text-xl font-serif italic text-accent leading-none">{shotsLeft} / {gallery.maxShots}</p>
              </div>
              <SavingPill label={savingLabel} retrying={queueState.retrying} />
            </div>
          </div>
        )}
      </div>


      <TutorialPopup
        isOpen={showTutorial}
        onClose={handleCloseTutorial}
        maxShots={gallery.maxShots}
        revealAt={gallery.revealAt.toDate()}
        galleryTitle={gallery.title}
      />

      <NotificationPrompt
        isOpen={showNotifPrompt}
        onAccept={handleNotifAccept}
        onDismiss={handleNotifDismiss}
      />
    </div>
  );
}

/** Small background-save status shown under the shot counter. */
function SavingPill({ label, retrying }: { label: string | null; retrying: boolean }) {
  return (
    <AnimatePresence>
      {label && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className={`flex items-center gap-1.5 bg-black/60 px-3 py-1.5 rounded-full border ${
            retrying ? "border-amber-400/30" : "border-white/10"
          }`}
        >
          <CloudUpload size={11} className={retrying ? "text-amber-300" : "text-accent animate-pulse"} />
          <span className="text-[9px] uppercase tracking-[0.15em] font-bold text-white/70 whitespace-nowrap">{label}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
