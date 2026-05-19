import React, { useState } from "react";
import { addDoc, collection, serverTimestamp, Timestamp } from "firebase/firestore";
import { db, auth, handleFirestoreError, OperationType } from "../lib/firebase";
import PageWrapper from "../components/PageWrapper";
import { ArrowLeft, Sparkles, Calendar, Clock, Camera } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function CreateEvent() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [revealAt, setRevealAt] = useState("");
  const [maxShots, setMaxShots] = useState(12);
  const [maxContributors, setMaxContributors] = useState(24);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    setLoading(true);
    try {
      await addDoc(collection(db, "galleries"), {
        creatorId: auth.currentUser.uid,
        title,
        description,
        startsAt: Timestamp.fromDate(new Date(startsAt)),
        revealAt: Timestamp.fromDate(new Date(revealAt)),
        maxShots: Number(maxShots),
        maxContributors: Number(maxContributors),
        createdAt: serverTimestamp(),
      });
      navigate("/dashboard");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "galleries");
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
            max="36"
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
            max="100"
            className="w-full accent-accent bg-white/5 h-1.5 rounded-full appearance-none cursor-pointer"
            value={maxContributors}
            onChange={(e) => setMaxContributors(Number(e.target.value))}
          />
        </div>

        <div className="pt-8">
          <button
            disabled={loading}
            className="w-full py-5 bg-white text-black rounded-[2.5rem] font-bold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center space-x-2 shadow-xl shadow-accent/5"
          >
            {loading ? "Initializing..." : (
              <>
                <span>Commit Event</span>
                <Sparkles size={18} />
              </>
            )}
          </button>
        </div>
      </form>
    </PageWrapper>
  );
}
