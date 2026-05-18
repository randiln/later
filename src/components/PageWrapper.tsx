import { motion } from "motion/react";
import { ReactNode } from "react";

export default function PageWrapper({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex-1 flex flex-col w-full max-w-md mx-auto px-6 py-12"
    >
      {children}
    </motion.div>
  );
}
