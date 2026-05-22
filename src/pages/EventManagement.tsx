import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, onSnapshot, collection } from "firebase/firestore";
import { db, logFirestoreError, OperationType } from "../lib/firebase";
import { Gallery } from "../types";
import { cn } from "../lib/utils";
import PageWrapper from "../components/PageWrapper";
import { ArrowLeft, Copy, Camera } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { isPast } from "date-fns";

export default function EventManagement() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [stats, setStats] = useState({ contributors: 0, photos: 0 });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;

    // Gallery listener
    const unsubGallery = onSnapshot(doc(db, "galleries", id), (docSnap) => {
      if (docSnap.exists()) {
        setGallery({ id: docSnap.id, ...docSnap.data() } as Gallery);
      } else {
        navigate("/dashboard");
      }
    }, (error) => {
      logFirestoreError(error, OperationType.GET, `galleries/${id}`);
    });

    // Live stats listener — keeps contributor and photo counts current.
    const unsubContributors = onSnapshot(
      collection(db, "galleries", id, "contributors"),
      (snap) => {
        let totalPhotos = 0;
        snap.forEach(d => {
          totalPhotos += (d.data().shotsTaken || 0);
        });
        setStats({ contributors: snap.size, photos: totalPhotos });
      },
      (error) => {
        logFirestoreError(error, OperationType.LIST, `galleries/${id}/contributors`);
      }
    );

    return () => {
      unsubGallery();
      unsubContributors();
    };
  }, [id]);

  if (!gallery) return null;

  const baseUrl = window.location.href.split("/event/")[0];
  const joinUrl = `${baseUrl}/join/${id}`;

  const copyLink = () => {
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasRevealed = isPast(gallery.revealAt.toDate());
  const isLive = isPast(gallery.startsAt.toDate()) && !hasRevealed;

  return (
    <PageWrapper>
      <div className="flex items-center space-x-4 mb-10">
        <button onClick={() => navigate("/dashboard")} className="p-2 -ml-2 text-zinc-500">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-2xl font-serif italic truncate">{gallery.title}</h2>
      </div>

      <div className="space-y-10">
        {/* View Gallery CTA — shown after reveal */}
        {hasRevealed && (
          <button
            onClick={() => navigate(`/gallery/${id}`)}
            className="w-full p-6 bg-accent text-zinc-950 rounded-[2.5rem] flex items-center justify-between shadow-2xl shadow-accent/10 active:scale-[0.98] transition-transform"
          >
            <div className="flex flex-col items-start">
              <span className="text-xl font-serif italic">View Gallery</span>
              <span className="text-zinc-950/60 text-xs font-medium uppercase tracking-widest mt-1">
                {stats.photos} {stats.photos === 1 ? "memory" : "memories"} unlocked
              </span>
            </div>
            <Camera size={28} />
          </button>
        )}

        {/* Info List */}
        <div className="space-y-6 pt-4">
          <InfoItem
            label="Event Status"
            value={hasRevealed ? "Revealed ✨" : isLive ? "Live Now" : "Scheduled"}
            accent={!hasRevealed}
          />
          <InfoItem label="Contributors" value={`${stats.contributors} Guests`} />
          <InfoItem label="Photos Taken" value={`${stats.photos}`} />
          <InfoItem label="Shutter Opens" value={gallery.startsAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
        </div>

        {/* QR Code Section */}
        <div className="bg-white p-10 rounded-[3rem] flex flex-col items-center justify-center space-y-8 shadow-2xl shadow-accent/10 relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-black/5 rounded-b-xl" />
          <div className="bg-white p-4 rounded-xl shadow-inner border border-zinc-50">
            <QRCodeSVG 
              value={joinUrl} 
              size={200} 
              level="M" 
              includeMargin={true} 
              fgColor="#000000"
              bgColor="#FFFFFF"
            />
          </div>
          <div className="text-center">
            <p className="text-zinc-950 font-bold text-lg">Scan to Join</p>
            <p className="text-zinc-400 text-[10px] mt-1 uppercase tracking-widest font-bold px-4">
              Share this QR code or link with your guests.
            </p>
          </div>
        </div>

        {/* Copy Link Button */}
        <button
          onClick={copyLink}
          className="w-full py-5 bg-card border border-white/5 rounded-2xl flex items-center justify-center space-x-3 active:scale-[0.98] transition-transform"
        >
          {copied ? (
            <span className="text-accent text-sm font-bold uppercase tracking-widest animate-pulse">Link Copied!</span>
          ) : (
            <>
              <Copy size={16} className="text-text-muted" />
              <span className="text-sm font-bold text-white/80 uppercase tracking-widest">Copy Invite Link</span>
            </>
          )}
        </button>

        {/* Reveal Info */}
        <div className="text-center pt-4">
           <p className="text-[10px] uppercase tracking-[0.3em] text-text-muted font-bold mb-2">
             {hasRevealed ? "Revealed On" : "The Big Reveal"}
           </p>
           <p className="text-2xl font-serif italic text-accent">
             {gallery.revealAt.toDate().toLocaleDateString()} at {gallery.revealAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
           </p>
        </div>
      </div>
    </PageWrapper>
  );
}

function InfoItem({ label, value, accent }: { label: string, value: string, accent?: boolean }) {
  return (
    <div className="flex flex-col space-y-1">
      <span className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold">{label}</span>
      <span className={cn(
        "text-2xl font-serif font-light italic",
        accent ? "text-accent" : "text-white"
      )}>{value}</span>
    </div>
  );
}
