import React, { useEffect, useState } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db, auth } from "../lib/firebase";
import { Gallery } from "../types";
import { cn } from "../lib/utils";
import PageWrapper from "../components/PageWrapper";
import { Plus, Calendar, Camera, ChevronRight, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { motion } from "motion/react";

export default function Dashboard() {
  const [upcoming, setUpcoming] = useState<Gallery[]>([]);
  const [past, setPast] = useState<Gallery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, "galleries"),
      where("creatorId", "==", auth.currentUser.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const all: Gallery[] = [];
      snapshot.forEach((doc) => {
        all.push({ id: doc.id, ...doc.data() } as Gallery);
      });

      setUpcoming(all.filter(g => g.status !== 'revealed'));
      setPast(all.filter(g => g.status === 'revealed'));
      setLoading(false);
      setError(null);
    }, (err) => {
      console.error("Dashboard query failed:", err);
      setError("Failed to load galleries. Check the console for details.");
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const handleLogout = () => {
    auth.signOut();
    navigate("/");
  };

  return (
    <PageWrapper>
      <div className="flex justify-between items-center mb-12">
        <h2 className="text-3xl font-serif italic">My Galleries</h2>
        <button 
          onClick={handleLogout}
          className="p-2 text-zinc-500 hover:text-white transition-colors"
        >
          <LogOut size={20} />
        </button>
      </div>

      <div className="space-y-10 flex-1">
        {/* Error banner */}
        {error && (
          <div className="p-4 bg-red-950/90 border border-red-500/30 rounded-2xl">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Actions */}
        <button
          onClick={() => navigate("/create")}
          className="w-full p-6 bg-accent text-zinc-950 rounded-[2.5rem] flex items-center justify-between shadow-2xl shadow-accent/10 active:scale-[0.98] transition-transform"
        >
          <div className="flex flex-col items-start">
            <span className="text-xl font-serif italic">New Event</span>
            <span className="text-zinc-950/60 text-xs font-medium uppercase tracking-widest mt-1">Start your camera</span>
          </div>
          <Plus size={28} />
        </button>

        {/* Upcoming Section */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 text-text-muted text-[10px] uppercase tracking-[0.2em] font-bold p-1">
            <Calendar size={14} />
            <span>Active Memories</span>
          </div>
          
          {loading ? (
            <div className="h-24 bg-card rounded-[2rem] animate-pulse" />
          ) : upcoming.length === 0 ? (
            <p className="text-text-muted italic text-sm py-4">No active events yet.</p>
          ) : (
            <div className="grid gap-4">
              {upcoming.map((g) => (
                <GalleryCard 
                  key={g.id} 
                  gallery={g} 
                  onClick={() => { navigate(`/event/${g.id}`); }} 
                />
              ))}
            </div>
          )}
        </section>

        {/* Revealed Section */}
        {past.length > 0 && (
          <section className="space-y-4 pt-4">
            <div className="flex items-center space-x-2 text-text-muted text-[10px] uppercase tracking-[0.2em] font-bold p-1">
              <Camera size={14} />
              <span>The Vault</span>
            </div>
            <div className="grid gap-4">
              {past.map((g) => (
                <GalleryCard 
                  key={g.id} 
                  gallery={g} 
                  onClick={() => { navigate(`/event/${g.id}`); }} 
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </PageWrapper>
  );
}

function GalleryCard({ gallery, onClick }: { gallery: Gallery; onClick: () => void; key?: string }) {
  const hasRevealed = gallery.status === 'revealed';
  
  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className="w-full p-6 bg-card border border-white/5 rounded-[2.5rem] flex items-center space-x-4 text-left shadow-lg"
    >
      <div className={cn(
        "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner",
        hasRevealed ? "bg-zinc-800/50 text-zinc-500" : "bg-accent/10 text-accent"
      )}>
        {hasRevealed ? <Camera size={26} strokeWidth={1} /> : <div className="w-2.5 h-2.5 bg-accent rounded-full animate-pulse" />}
      </div>
      
      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-serif italic truncate">{gallery.title}</h3>
        <p className="text-xs text-text-muted mt-0.5 font-medium uppercase tracking-wider">
          {hasRevealed 
            ? `Revealed ${formatDistanceToNow(gallery.revealAt.toDate())} ago`
            : `Unlocks in ${formatDistanceToNow(gallery.revealAt.toDate())}`
          }
        </p>
      </div>
      
      <ChevronRight size={20} className="text-zinc-800" />
    </motion.button>
  );
}
