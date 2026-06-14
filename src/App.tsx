/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./lib/firebase";
import { AnimatePresence } from "motion/react";
import LoadingScreen from "./components/LoadingScreen";

// Pages (will create these)
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import CreateEvent from "./pages/CreateEvent";
import EventManagement from "./pages/EventManagement";
import Join from "./pages/Join";
import Capture from "./pages/Capture";
import GalleryView from "./pages/GalleryView";
import RequestCustomRoom from "./pages/RequestCustomRoom";
import AdminPanel from "./pages/AdminPanel";

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

  if (loading) return <LoadingScreen />;

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-bg text-white overflow-hidden relative font-sans selection:bg-accent/30 grainy">
        {/* Atmospheric Background */}
        <div className="atmosphere" />

        <div className="relative z-10 flex flex-col min-h-screen">
          <AnimatedRoutes user={user} />
        </div>
      </div>
    </BrowserRouter>
  );
}

function AnimatedRoutes({ user }: { user: User | null }) {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <div key={location.pathname} className="flex-1 flex flex-col">
        <Routes location={location}>
          {/* Creator Routes */}
          <Route path="/" element={<Home user={user} />} />
          <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/" />} />
          <Route path="/create" element={user ? <CreateEvent /> : <Navigate to="/" />} />
          <Route path="/event/:id" element={user ? <EventManagement /> : <Navigate to="/" />} />
          <Route path="/request-custom" element={user ? <RequestCustomRoom /> : <Navigate to="/" />} />
          <Route path="/admin" element={user ? <AdminPanel /> : <Navigate to="/" />} />

          {/* Contributor Routes */}
          <Route path="/join/:id" element={<Join />} />
          <Route path="/capture/:id" element={<Capture />} />
          <Route path="/gallery/:id" element={<GalleryView />} />
        </Routes>
      </div>
    </AnimatePresence>
  );
}

