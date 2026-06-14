import React, { useState } from "react";
import { addDoc, collection, serverTimestamp, Timestamp } from "firebase/firestore";
import { db, auth, logFirestoreError, OperationType } from "../lib/firebase";
import PageWrapper from "../components/PageWrapper";
import Button from "../components/Button";
import { ArrowLeft, Sparkles, CheckCircle, Crown, Users, Camera, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";

export default function RequestCustomRoom() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [eventTitle, setEventTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [revealAt, setRevealAt] = useState("");
  const [guestCount, setGuestCount] = useState(50);
  const [shotsPerPerson, setShotsPerPerson] = useState(20);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    const startDate = new Date(startsAt);
    const revealDate = new Date(revealAt);

    if (isNaN(startDate.getTime()) || isNaN(revealDate.getTime())) {
      setError("Please pick valid start and reveal times.");
      return;
    }
    if (revealDate <= startDate) {
      setError("The reveal time must be after the start time.");
      return;
    }
    if (revealDate <= new Date()) {
      setError("The reveal time must be in the future.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await addDoc(collection(db, "customRequests"), {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email,
        eventTitle,
        startsAt: Timestamp.fromDate(startDate),
        revealAt: Timestamp.fromDate(revealDate),
        guestCount: Number(guestCount),
        shotsPerPerson: Number(shotsPerPerson),
        status: "pending",
        createdAt: serverTimestamp(),
      });
      setSubmitted(true);
    } catch (err) {
      logFirestoreError(err, OperationType.CREATE, "customRequests");
      setError("Couldn't submit your request. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <PageWrapper>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex-1 flex flex-col items-center justify-center text-center space-y-8 py-12"
        >
          <div className="w-20 h-20 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
            <CheckCircle size={36} className="text-accent" />
          </div>
          <div className="space-y-3">
            <h2 className="text-3xl font-serif italic text-white/90">Request received</h2>
            <p className="text-text-muted text-sm max-w-[280px] mx-auto leading-relaxed">
              We'll review your request and reach out to arrange payment. Once confirmed, your custom gallery will appear in your dashboard automatically.
            </p>
          </div>
          <div className="w-full border-y border-white/5 py-6 space-y-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold">What happens next</p>
            {[
              "You'll hear from us within 24 hours",
              "Payment is arranged externally",
              "Your gallery is created and ready to go",
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3 text-left">
                <div className="w-5 h-5 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                  <span className="text-[9px] text-accent font-bold">{i + 1}</span>
                </div>
                <p className="text-sm text-white/70">{step}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="text-text-muted text-xs uppercase tracking-widest font-bold hover:text-white transition-colors"
          >
            Back to dashboard
          </button>
        </motion.div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="flex items-center space-x-4 mb-10">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-zinc-500">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-2xl font-serif italic text-white/90">Custom Room</h2>
      </div>

      {/* Pricing callout */}
      <div className="mb-8 p-5 rounded-[2rem] bg-gradient-to-br from-accent/10 to-accent/5 border border-accent/20 space-y-4">
        <div className="flex items-center gap-2">
          <Crown size={16} className="text-accent" />
          <span className="text-[10px] uppercase tracking-widest font-bold text-accent">Paid upgrade</span>
        </div>
        <p className="text-white/90 text-sm leading-relaxed font-medium">
          Custom rooms are built for larger events — weddings, festivals, corporate gatherings. Pricing is arranged directly after your request.
        </p>
        <div className="grid grid-cols-3 gap-3 pt-1">
          {[
            { icon: <Users size={14} />, label: "Unlimited guests" },
            { icon: <Camera size={14} />, label: "Higher shot counts" },
            { icon: <Clock size={14} />, label: "Custom timelines" },
          ].map((f, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5 p-2 rounded-xl bg-white/5 border border-white/5">
              <div className="text-accent">{f.icon}</div>
              <span className="text-[9px] text-text-muted text-center leading-tight font-medium">{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 flex-1">
        {/* Event Title */}
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold ml-1">Event Title</label>
          <input
            required
            placeholder="E.g., The Johnson Wedding"
            className="w-full bg-transparent border-b border-white/10 p-4 text-xl outline-none transition-colors font-serif italic placeholder:opacity-20 placeholder:font-sans placeholder:not-italic focus:border-accent"
            value={eventTitle}
            onChange={(e) => setEventTitle(e.target.value)}
          />
        </div>

        {/* Start + Reveal */}
        <div className="grid grid-cols-2 gap-8">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold ml-1">Start Time</label>
            <input
              required
              type="datetime-local"
              className="w-full bg-card border border-white/5 rounded-2xl p-4 text-xs font-medium focus:border-accent outline-none"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold ml-1">Reveal Time</label>
            <input
              required
              type="datetime-local"
              className="w-full bg-card border border-white/5 rounded-2xl p-4 text-xs font-medium focus:border-accent outline-none"
              value={revealAt}
              onChange={(e) => setRevealAt(e.target.value)}
            />
          </div>
        </div>

        {/* Guest Count */}
        <div className="space-y-4 pt-2">
          <div className="flex justify-between items-center px-1">
            <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold">Expected Guests</label>
            <span className="text-accent font-mono font-bold text-lg">{guestCount}</span>
          </div>
          <input
            type="range"
            min="11"
            max="500"
            className="w-full accent-accent bg-white/5 h-1.5 rounded-full appearance-none cursor-pointer"
            value={guestCount}
            onChange={(e) => setGuestCount(Number(e.target.value))}
          />
          <p className="text-[10px] text-text-muted ml-1">Free plan supports up to 10 guests.</p>
        </div>

        {/* Shots Per Person */}
        <div className="space-y-4 pt-2">
          <div className="flex justify-between items-center px-1">
            <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold">Shots Per Guest</label>
            <span className="text-accent font-mono font-bold text-lg">{shotsPerPerson}</span>
          </div>
          <input
            type="range"
            min="13"
            max="100"
            className="w-full accent-accent bg-white/5 h-1.5 rounded-full appearance-none cursor-pointer"
            value={shotsPerPerson}
            onChange={(e) => setShotsPerPerson(Number(e.target.value))}
          />
          <p className="text-[10px] text-text-muted ml-1">Free plan supports up to 12 shots per guest.</p>
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-950/90 border border-red-500/30 rounded-2xl">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        <div className="pt-4 space-y-3">
          <Button type="submit" disabled={loading} variant="accent">
            {loading ? "Submitting..." : (
              <>
                <span>Send Request</span>
                <Sparkles size={18} />
              </>
            )}
          </Button>
          <p className="text-center text-[10px] text-text-muted leading-relaxed">
            No payment now. We'll reach out to confirm details and arrange payment before creating your room.
          </p>
        </div>
      </form>
    </PageWrapper>
  );
}
