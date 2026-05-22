import { motion } from "motion/react";

export default function LoadingScreen({ message = "Later..." }: { message?: string }) {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <motion.div
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="text-white font-serif italic"
      >
        {message}
      </motion.div>
    </div>
  );
}
