import React, { useState } from "react";
import { addDoc, collection, serverTimestamp, Timestamp } from "firebase/firestore";
import { db, auth, logFirestoreError, OperationType } from "../lib/firebase";
import PageWrapper from "../components/PageWrapper";
import Button from "../components/Button";
import { ArrowLeft, Sparkles, Crown, ChevronRight, Settings2, ChevronDown, ChevronUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";

const FREE_MAX_SHOTS = 12;
const FREE_MAX_CONTRIBUTORS = 10;

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

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifInactivity, setNotifInactivity] = useState(10);
  const [notifRecurrent, setNotifRecurrent] = useState(false);
  const [notifBeforeEnd, setNotifBeforeEnd] = useState(5);
  const [notifReveal, setNotifReveal] = useState(true);

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
        notificationSettings: {
          enabled: notifEnabled,
          inactivityInterval: notifInactivity,
          recurrentInactivity: notifRecurrent,
          beforeEndReminder: notifBeforeEnd,
          notifyOnReveal: notifReveal,
        },
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

        {/* Shots per Guest */}
        <div className="space-y-3 pt-4">
          <div className="flex justify-between items-center px-1">
            <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold">Shots per Guest</label>
            <span className="text-accent font-mono font-bold text-lg">{maxShots}</span>
          </div>
          <input
            type="range"
            min="1"
            max={FREE_MAX_SHOTS}
            className="w-full accent-accent bg-white/5 h-1.5 rounded-full appearance-none cursor-pointer"
            value={maxShots}
            onChange={(e) => setMaxShots(Number(e.target.value))}
          />
        </div>

        {/* Guest Capacity */}
        <div className="space-y-3 pt-4">
          <div className="flex justify-between items-center px-1">
            <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold">Guest Capacity</label>
            <span className="text-accent font-mono font-bold text-lg">{maxContributors}</span>
          </div>
          <input
            type="range"
            min="2"
            max={FREE_MAX_CONTRIBUTORS}
            className="w-full accent-accent bg-white/5 h-1.5 rounded-full appearance-none cursor-pointer"
            value={maxContributors}
            onChange={(e) => setMaxContributors(Number(e.target.value))}
          />
        </div>

        {/* Single consolidated upsell — appears only when both sliders are fully maxed */}
        <AnimatePresence>
          {maxShots >= FREE_MAX_SHOTS && maxContributors >= FREE_MAX_CONTRIBUTORS && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              onClick={() => navigate("/request-custom")}
              className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-br from-accent/8 to-accent/4 border border-accent/15 text-left hover:border-accent/30 transition-colors group"
            >
              <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 group-hover:bg-accent/20 transition-colors">
                <Crown size={15} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-white/80">Need more guests or shots?</p>
                <p className="text-[11px] text-text-muted mt-0.5">Custom rooms are available for larger events — paid.</p>
              </div>
              <ChevronRight size={14} className="text-zinc-600 group-hover:text-accent transition-colors shrink-0" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Advanced Settings */}
        <div className="pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-text-muted hover:text-white transition-colors py-2"
          >
            <Settings2 size={16} />
            <span className="text-xs font-semibold uppercase tracking-widest">Advanced Settings</span>
            {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          
          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-6 space-y-6 border-t border-white/5 mt-4">
                  {/* Master Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white/90">Notify Users</p>
                      <p className="text-xs text-text-muted mt-1">Send browser push notifications to guests</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" checked={notifEnabled} onChange={(e) => setNotifEnabled(e.target.checked)} />
                      <div className="w-11 h-6 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                    </label>
                  </div>

                  {notifEnabled && (
                    <div className="space-y-5 bg-white/[0.02] p-5 rounded-2xl border border-white/5">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold ml-1">Inactivity Reminder</label>
                        <select
                          className="w-full bg-card border border-white/5 rounded-xl p-3 text-xs font-medium focus:border-accent outline-none appearance-none"
                          value={notifInactivity}
                          onChange={(e) => setNotifInactivity(Number(e.target.value))}
                        >
                          <option value={0}>Off</option>
                          <option value={5}>After 5 minutes</option>
                          <option value={10}>After 10 minutes</option>
                          <option value={15}>After 15 minutes</option>
                          <option value={30}>After 30 minutes</option>
                        </select>
                      </div>

                      {notifInactivity > 0 && (
                        <div className="flex items-center justify-between pl-1">
                          <span className="text-xs text-text-muted font-medium">Recurrent reminders</span>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={notifRecurrent} onChange={(e) => setNotifRecurrent(e.target.checked)} />
                            <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                          </label>
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-bold ml-1">Event Ending Reminder</label>
                        <select
                          className="w-full bg-card border border-white/5 rounded-xl p-3 text-xs font-medium focus:border-accent outline-none appearance-none"
                          value={notifBeforeEnd}
                          onChange={(e) => setNotifBeforeEnd(Number(e.target.value))}
                        >
                          <option value={0}>Off</option>
                          <option value={5}>5 minutes before</option>
                          <option value={10}>10 minutes before</option>
                          <option value={15}>15 minutes before</option>
                          <option value={30}>30 minutes before</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between pl-1">
                        <span className="text-xs text-text-muted font-medium">Notify on Reveal</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" className="sr-only peer" checked={notifReveal} onChange={(e) => setNotifReveal(e.target.checked)} />
                          <div className="w-9 h-5 bg-white/10 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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

      {/* Passive always-visible custom room upsell (subtle) */}
      <button
        onClick={() => navigate("/request-custom")}
        className="mt-8 w-full p-4 rounded-[2rem] border border-white/[0.05] flex items-center gap-3 text-left hover:border-white/10 transition-colors group"
      >
        <Crown size={15} className="text-zinc-700 group-hover:text-accent transition-colors shrink-0" />
        <p className="text-xs text-zinc-700 group-hover:text-text-muted transition-colors flex-1">
          Hosting a larger event? <span className="underline underline-offset-2">Request a custom room</span>
        </p>
        <ChevronRight size={13} className="text-zinc-800 group-hover:text-zinc-600 transition-colors shrink-0" />
      </button>
    </PageWrapper>
  );
}
