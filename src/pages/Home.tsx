import { useState } from "react";
import { User, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useNavigate } from "react-router-dom";
import PageWrapper from "../components/PageWrapper";
import { Camera, ArrowRight, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";

export default function Home({ user }: { user: User | null }) {
  const navigate = useNavigate();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async () => {
    setErrorMsg(null);
    try {
      const provider = new GoogleAuthProvider();
      // Enforce the custom OAuth parameters to help mitigate pop-up issues
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      await signInWithPopup(auth, provider);
      navigate("/dashboard");
    } catch (error: any) {
      console.error("Login failed", error);
      if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
        setErrorMsg("Popup was closed or blocked. Please try again. If the issue persists, open the app in a new tab.");
      } else {
        setErrorMsg(error.message || "Failed to sign in.");
      }
    }
  };

  return (
    <PageWrapper>
      <div className="flex-1 flex flex-col items-center justify-center text-center space-y-12">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="relative"
        >
          <div className="w-24 h-24 bg-accent rounded-full flex items-center justify-center blur-2xl absolute inset-0 opacity-20" />
          <Camera size={64} className="relative z-10 text-accent" strokeWidth={1} />
        </motion.div>

        <div className="space-y-4">
          <h1 className="text-7xl font-serif tracking-tight leading-none italic text-accent">
            Later.
          </h1>
          <p className="text-text-muted font-light text-lg max-w-[280px] mx-auto leading-relaxed">
            A shared disposable camera for your most intimate moments.
          </p>
        </div>

        <div className="w-full space-y-4 pt-8">
          {errorMsg && (
            <p className="text-red-500 text-sm">{errorMsg}</p>
          )}
          {user ? (
            <button
              onClick={() => navigate("/dashboard")}
              className="w-full py-5 bg-zinc-100 text-zinc-950 rounded-2xl font-medium flex items-center justify-center space-x-2 active:scale-[0.98] transition-transform"
            >
              <span>Manage Events</span>
              <ArrowRight size={18} />
            </button>
          ) : (
            <button
              onClick={handleLogin}
              className="w-full py-5 bg-white text-black rounded-2xl font-medium flex items-center justify-center space-x-2 active:scale-[0.98] transition-transform shadow-xl shadow-accent/5"
            >
              <ShieldCheck size={18} />
              <span>Creator Sign In</span>
            </button>
          )}
          
          <p className="text-[10px] text-text-muted uppercase tracking-[0.2em] font-bold">
            Contributors don't need an account
          </p>
        </div>
      </div>
    </PageWrapper>
  );
}
