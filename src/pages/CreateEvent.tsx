import React, { useState } from "react";
import { addDoc, collection, serverTimestamp, Timestamp } from "firebase/firestore";
import { db, auth, logFirestoreError, OperationType } from "../lib/firebase";
import PageWrapper from "../components/PageWrapper";
import Button from "../components/Button";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function CreateEvent() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [revealAt, setRevealAt] = useState("");
  const [maxShots, setMaxShots] = useState(12);
  const [maxContributors, setMaxContributors] = useState(10);
  const [error, setError] = useState<string | null>(null);

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
      await addDoc(collection(db, "galleries"), {
        creatorId: auth.currentUser.uid,
        title,
        description,
        startsAt: Timestamp.fromDate(startDate),
        revealAt: Timestamp.fromDate(revealDate),
        maxShots: Number(maxShots),
        maxContributors: Number(maxContributors),
        status: 'upcoming',
        createdAt: serverTimestamp(),
      });
      navigate("/dashboard");
    } catch (err) {
      logFirestoreError(err, OperationType.CREATE, "galleries");
      setError("Couldn't create the event. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageWrapper>
      <div className="flex items-center space-x-4 mb-10">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-zinc-500">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-2xl font-serif italic text-white/90">Initialize Camera</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 flex-1">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold ml-1">Event Title</label>
          <input
            required
            placeholder="E.g., The Miller Wedding"
            className="w-full bg-transparent border-b border-white/10 p-4 text-xl outline-none transition-colors font-serif italic placeholder:opacity-20 placeholder:font-sans placeholder:not-italic focus:border-accent"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

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

        <div className="space-y-4 pt-4">
          <div className="flex justify-between items-center px-1">
            <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold">Shots per Guest</label>
            <span className="text-accent font-mono font-bold text-lg">{maxShots}</span>
          </div>
          <input
            type="range"
            min="1"
            max="20"
            className="w-full accent-accent bg-white/5 h-1.5 rounded-full appearance-none cursor-pointer"
            value={maxShots}
            onChange={(e) => setMaxShots(Number(e.target.value))}
          />
        </div>

        <div className="space-y-4 pt-4">
          <div className="flex justify-between items-center px-1">
            <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold">Guest Capacity</label>
            <span className="text-accent font-mono font-bold text-lg">{maxContributors}</span>
          </div>
          <input
            type="range"
            min="2"
            max="15"
            className="w-full accent-accent bg-white/5 h-1.5 rounded-full appearance-none cursor-pointer"
            value={maxContributors}
            onChange={(e) => setMaxContributors(Number(e.target.value))}
          />
        </div>

        <div className="pt-8 space-y-4">
          {error && (
            <div className="p-4 bg-red-950/90 border border-red-500/30 rounded-2xl">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}
          <Button type="submit" disabled={loading}>
            {loading ? "Initializing..." : (
              <>
                <span>Commit Event</span>
                <Sparkles size={18} />
              </>
            )}
          </Button>
        </div>
      </form>
    </PageWrapper>
  );
}
