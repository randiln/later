import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Camera, Lock, Clock, Smartphone, Sparkles, X, ChevronRight } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import Badge from "./Badge";

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
  const formattedTime = format(revealAt, "EEEE, h:mm a");
  const timeFromNow = formatDistanceToNow(revealAt, { addSuffix: true });

  const steps = [
    {
      icon: <Camera className="text-accent" size={22} />,
      title: `${maxShots} Shots Total`,
      description: `Think of it like film. You have a limited roll of ${maxShots} shots. No retakes, no deleting. Make every moment count.`,
    },
    {
      icon: <Smartphone className="text-accent" size={22} />,
      title: "Exit & Return Anytime",
      description: "Feel free to close your browser. Your remaining shot count and nickname are safely stored, allowing you to jump back in whenever you need.",
    },
    {
      icon: <Sparkles className="text-accent" size={22} />,
      title: "Camera Controls",
      description: "Tap the screen to focus, use the 1x/2x/4x buttons to zoom, flip between front/rear lenses, and toggle flash if your device supports it.",
    },
    {
      icon: <Lock className="text-accent" size={22} />,
      title: `Reveals ${timeFromNow}`,
      description: `All photos develop together in the vault. The shared memories will be unlocked and visible to everyone on ${formattedTime}.`,
    },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 overflow-y-auto">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="relative w-full max-w-lg bg-zinc-950/90 border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl p-6 md:p-8 flex flex-col space-y-6 max-h-[85vh] md:max-h-none overflow-y-auto"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-6 right-6 w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/60 active:scale-90 transition-all hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>

            {/* Header */}
            <div className="space-y-3 pr-8">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono tracking-widest text-accent uppercase font-bold">LATER</span>
                <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
                <Badge label="Contributor Guide" tone="accent" className="px-2.5 py-0.5" />
              </div>
              <h2 className="text-3xl md:text-4xl font-serif italic text-white/90 leading-tight">
                Welcome to {galleryTitle}
              </h2>
              <p className="text-text-muted text-xs md:text-sm">
                You’ve joined as a contributor. Here is how we capture memories:
              </p>
            </div>

            {/* Feature Steps */}
            <div className="space-y-5 my-2">
              {steps.map((step, idx) => (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.08 }}
                  key={idx}
                  className="flex items-start space-x-4 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.04]"
                >
                  <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl shrink-0 mt-0.5">
                    {step.icon}
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-white/90">{step.title}</h3>
                    <p className="text-xs text-text-muted leading-relaxed">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* CTA Button */}
            <button
              onClick={onClose}
              className="w-full py-4 bg-accent text-zinc-950 hover:bg-accent/90 rounded-[2.5rem] font-bold text-sm tracking-wider uppercase flex items-center justify-center space-x-2 shadow-xl shadow-accent/10 active:scale-[0.98] transition-all"
            >
              <span>Open Shutter</span>
              <ChevronRight size={16} />
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
