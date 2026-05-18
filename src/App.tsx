/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./lib/firebase";
import { motion, AnimatePresence } from "motion/react";

// Pages (will create these)
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import CreateEvent from "./pages/CreateEvent";
import EventManagement from "./pages/EventManagement";
import Join from "./pages/Join";
import Capture from "./pages/Capture";
import GalleryView from "./pages/GalleryView";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-[#0a0502] flex items-center justify-center">
      <motion.div 
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="text-white font-serif italic"
      >
        Later...
      </motion.div>
    </div>
  );

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-bg text-white overflow-hidden relative font-sans selection:bg-accent/30 grainy">
        {/* Atmospheric Background */}
        <div className="atmosphere" />

        <div className="relative z-10 flex flex-col min-h-screen">
          <AnimatePresence mode="wait">
            <Routes>
              {/* Creator Routes */}
              <Route path="/" element={<Home user={user} />} />
              <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/" />} />
              <Route path="/create" element={user ? <CreateEvent /> : <Navigate to="/" />} />
              <Route path="/event/:id" element={user ? <EventManagement /> : <Navigate to="/" />} />
              
              {/* Contributor Routes */}
              <Route path="/join/:id" element={<Join />} />
              <Route path="/capture/:id" element={<Capture />} />
              <Route path="/gallery/:id" element={<GalleryView />} />
            </Routes>
          </AnimatePresence>
        </div>
      </div>
    </BrowserRouter>
  );
}

