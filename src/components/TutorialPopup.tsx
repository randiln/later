import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Camera, EyeOff, Smartphone, SlidersHorizontal, Lock, ArrowRight, X } from "lucide-react";
import { format } from "date-fns";

interface TutorialPopupProps {
  isOpen: boolean;
  onClose: () => void;
  maxShots: number;
  revealAt: Date;
  galleryTitle: string;
}

export default function TutorialPopup({
  isOpen,
  onClose,
  maxShots,
  revealAt,
  galleryTitle,
}: TutorialPopupProps) {
  // Format to match "Sunday at 7:52 AM"
  const formattedTime = format(revealAt, "EEEE 'at' h:mm a");

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
          />

          {/* Modal Container (.lw) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="relative w-full max-w-md bg-zinc-950/95 border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl p-4 sm:p-5 md:p-6 flex flex-col justify-between max-h-[96dvh] gap-y-4"
          >
            {/* Header (.lw-header) */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {/* Dot (.lw-dot) */}
                <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                {/* Wordmark (.lw-wordmark) */}
                <span className="text-lg font-serif italic font-bold text-white tracking-wide">Later</span>
                {/* Pill (.lw-pill) */}
                <span className="px-2 py-0.5 bg-white/5 border border-white/10 text-[8px] uppercase tracking-widest font-mono text-text-muted rounded-full">
                  Contributor guide
                </span>
              </div>
              
              {/* Close Button (.lw-close) */}
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>

            {/* Hero (.lw-hero) */}
            <div className="space-y-0.5">
              <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                A shared disposable camera for your event.
              </p>
              <h1 className="text-2xl md:text-3xl font-serif italic text-white/90 leading-tight">
                Welcome to <span className="text-accent">{galleryTitle}</span>
              </h1>
            </div>

            {/* Film Strip (.film-strip) */}
            <div className="flex items-center justify-center gap-1 bg-black/60 border-y border-white/5 py-1.5 overflow-hidden rounded-lg w-full" aria-hidden="true">
              {/* Left Sprocket */}
              <div className="flex flex-col gap-2 px-1 shrink-0">
                <div className="w-1.5 h-2 bg-black border border-white/10 rounded-sm" />
                <div className="w-1.5 h-2 bg-black border border-white/10 rounded-sm" />
              </div>

              {/* Frames */}
              <div className="w-6 h-8 bg-zinc-900 border border-accent bg-accent/5 rounded shrink-0" />
              <div className="w-6 h-8 bg-zinc-900 border border-accent bg-accent/5 rounded shrink-0" />
              <div className="w-6 h-8 bg-zinc-900 border border-accent bg-accent/5 rounded shrink-0" />
              <div className="w-6 h-8 bg-zinc-900 border border-white/10 rounded shrink-0" />
              <div className="w-6 h-8 bg-zinc-900 border border-white/10 rounded shrink-0" />
              
              {/* Locked Frames */}
              <div className="w-6 h-8 bg-zinc-950 border border-white/5 rounded shrink-0 flex items-center justify-center text-[8px] text-white/20">
                <Lock size={8} className="opacity-30" />
              </div>
              <div className="w-6 h-8 bg-zinc-950 border border-white/5 rounded shrink-0 flex items-center justify-center text-[8px] text-white/20">
                <Lock size={8} className="opacity-30" />
              </div>
              <div className="w-6 h-8 bg-zinc-950 border border-white/5 rounded shrink-0 flex items-center justify-center text-[8px] text-white/20">
                <Lock size={8} className="opacity-30" />
              </div>

              {/* Right Sprocket */}
              <div className="flex flex-col gap-2 px-1 shrink-0">
                <div className="w-1.5 h-2 bg-black border border-white/10 rounded-sm" />
                <div className="w-1.5 h-2 bg-black border border-white/10 rounded-sm" />
              </div>
            </div>

            {/* Features (.lw-features) - 2x2 Grid for compact viewport fitting */}
            <div className="grid grid-cols-2 gap-2.5">
              {/* Feature 1 */}
              <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white/[0.01] border border-white/[0.03]">
                <div className="p-1.5 bg-white/5 border border-white/10 rounded-lg shrink-0 text-accent mt-0.5">
                  <Camera size={14} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="inline-block px-1.5 py-0.5 mb-1 bg-accent/15 border border-accent/30 text-accent text-[8px] uppercase font-bold tracking-wider rounded">
                    {maxShots} shots
                  </div>
                  <p className="text-[11px] font-semibold text-white/90 leading-tight">A limited roll</p>
                  <p className="text-[10px] text-text-muted leading-tight mt-0.5">
                    No retakes, no deleting. Once you shoot, it's locked.
                  </p>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white/[0.01] border border-white/[0.03]">
                <div className="p-1.5 bg-white/5 border border-white/10 rounded-lg shrink-0 text-accent mt-0.5">
                  <EyeOff size={14} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-white/90 leading-tight">Private vault</p>
                  <p className="text-[10px] text-text-muted leading-tight mt-0.5">
                    Every photo is locked until reveal. No peeking!
                  </p>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white/[0.01] border border-white/[0.03]">
                <div className="p-1.5 bg-white/5 border border-white/10 rounded-lg shrink-0 text-accent mt-0.5">
                  <Smartphone size={14} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-white/90 leading-tight">Come & go</p>
                  <p className="text-[10px] text-text-muted leading-tight mt-0.5">
                    Close tab anytime. Shots are saved automatically.
                  </p>
                </div>
              </div>

              {/* Feature 4 */}
              <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white/[0.01] border border-white/[0.03]">
                <div className="p-1.5 bg-white/5 border border-white/10 rounded-lg shrink-0 text-accent mt-0.5">
                  <SlidersHorizontal size={14} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-white/90 leading-tight">Camera controls</p>
                  <p className="text-[10px] text-text-muted leading-tight mt-0.5">
                    Focus, 1×/2×/4× zoom, flip lens, toggle flash.
                  </p>
                </div>
              </div>
            </div>

            {/* Reveal (.lw-reveal) */}
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-accent/5 border border-accent/10">
              <div className="p-2 bg-accent/10 border border-accent/20 rounded-xl shrink-0 text-accent">
                <Lock size={15} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1.5 flex-wrap">
                  <p className="text-[8px] uppercase tracking-[0.2em] font-bold text-accent/60">Vault unlocks</p>
                  <p className="text-[13px] font-serif italic text-accent font-semibold">{formattedTime}</p>
                </div>
                <p className="text-[10px] text-text-muted mt-0.5 leading-tight">
                  All photos reveal at once — check back then to see the full roll.
                </p>
              </div>
            </div>

            {/* Footer / CTA Button (.lw-footer) */}
            <div className="pt-1">
              <button
                onClick={onClose}
                className="w-full py-3.5 bg-accent text-zinc-950 hover:bg-accent/90 rounded-[2.5rem] font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 shadow-xl shadow-accent/10 active:scale-[0.98] transition-all cursor-pointer"
              >
                <span>Get started</span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
