import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bell, X } from "lucide-react";
import { canNotify, isIOS, isPWA, getPermissionStatus } from "../lib/notifications";

interface NotificationPromptProps {
  isOpen: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

export default function NotificationPrompt({
  isOpen,
  onAccept,
  onDismiss,
}: NotificationPromptProps) {
  const iosNeedsPWA = isIOS() && !isPWA();
  const permissionDenied = getPermissionStatus() === 'denied';

  // Don't show if permission was already denied at the browser level
  if (permissionDenied) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3 }}
          className="absolute bottom-[240px] inset-x-4 z-40 pointer-events-auto"
        >
          <div className="bg-zinc-950/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl">
            <button
              onClick={onDismiss}
              className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white"
            >
              <X size={12} />
            </button>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-accent/10 border border-accent/20 rounded-xl shrink-0 mt-0.5">
                <Bell size={16} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0 pr-4">
                <p className="text-[12px] font-semibold text-white/90">Don't forget your shots</p>
                <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                  {iosNeedsPWA
                    ? "To get reminders, add Later to your Home Screen first (tap the share icon → \"Add to Home Screen\")."
                    : "We'll send you a gentle reminder if you have unused shots."}
                </p>
              </div>
            </div>

            {!iosNeedsPWA && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={onDismiss}
                  className="flex-1 py-2 text-[10px] uppercase tracking-widest font-bold text-text-muted rounded-xl hover:text-white transition-colors"
                >
                  Not now
                </button>
                <button
                  onClick={onAccept}
                  className="flex-1 py-2 bg-accent text-zinc-950 text-[10px] uppercase tracking-widest font-bold rounded-xl active:scale-[0.98] transition-transform shadow-lg shadow-accent/10"
                >
                  Enable reminders
                </button>
              </div>
            )}

            {iosNeedsPWA && (
              <button
                onClick={onDismiss}
                className="w-full mt-3 py-2 text-[10px] uppercase tracking-widest font-bold text-text-muted rounded-xl hover:text-white transition-colors"
              >
                Got it
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
