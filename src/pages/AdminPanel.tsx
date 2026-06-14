import React, { useEffect, useState } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  addDoc,
  doc,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { db, auth, logFirestoreError, OperationType } from "../lib/firebase";
import PageWrapper from "../components/PageWrapper";
import { ArrowLeft, Check, X, Clock, Users, Camera, ChevronRight, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow, format } from "date-fns";
import { motion, AnimatePresence } from "motion/react";

const ADMIN_UID = import.meta.env.VITE_ADMIN_UID as string | undefined;

interface CustomRequest {
  id: string;
  uid: string;
  email: string;
  eventTitle: string;
  startsAt: Timestamp;
  revealAt: Timestamp;
  guestCount: number;
  shotsPerPerson: number;
  status: "pending" | "approved" | "rejected";
  createdAt: Timestamp;
  reviewedAt?: Timestamp;
  adminNote?: string;
  galleryId?: string;
}

type Tab = "pending" | "approved" | "rejected";

export default function AdminPanel() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<CustomRequest[]>([]);
  const [tab, setTab] = useState<Tab>("pending");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) {
      navigate("/");
      return;
    }
    if (!ADMIN_UID || auth.currentUser.uid !== ADMIN_UID) {
      setUnauthorized(true);
      setLoading(false);
      return;
    }

    const q = query(collection(db, "customRequests"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const all: CustomRequest[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CustomRequest));
        setRequests(all);
        setLoading(false);
      },
      (err) => {
        logFirestoreError(err, OperationType.LIST, "customRequests");
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  const handleApprove = async (req: CustomRequest) => {
    if (actionLoading) return;
    setActionLoading(req.id);
    try {
      // Create the gallery under the requestor's account
      const galleryRef = await addDoc(collection(db, "galleries"), {
        creatorId: req.uid,
        title: req.eventTitle,
        description: "",
        startsAt: req.startsAt,
        revealAt: req.revealAt,
        maxShots: req.shotsPerPerson,
        maxContributors: req.guestCount,
        status: "upcoming",
        createdAt: serverTimestamp(),
      });

      // Mark request as approved
      await updateDoc(doc(db, "customRequests", req.id), {
        status: "approved",
        galleryId: galleryRef.id,
        reviewedAt: serverTimestamp(),
        adminNote: adminNote || null,
      });

      setAdminNote("");
      setExpandedId(null);
    } catch (err) {
      logFirestoreError(err, OperationType.CREATE, `galleries / customRequests/${req.id}`);
      alert("Failed to approve request. Check console.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (req: CustomRequest) => {
    if (actionLoading) return;
    setActionLoading(req.id);
    try {
      await updateDoc(doc(db, "customRequests", req.id), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        adminNote: adminNote || null,
      });
      setAdminNote("");
      setExpandedId(null);
    } catch (err) {
      logFirestoreError(err, OperationType.UPDATE, `customRequests/${req.id}`);
      alert("Failed to reject request. Check console.");
    } finally {
      setActionLoading(null);
    }
  };

  if (unauthorized) {
    return (
      <PageWrapper>
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
          <AlertCircle size={40} className="text-red-400" />
          <h2 className="text-2xl font-serif italic text-white/90">Access Denied</h2>
          <p className="text-text-muted text-sm">This panel is restricted to administrators.</p>
          <button onClick={() => navigate("/dashboard")} className="text-text-muted text-xs uppercase tracking-widest font-bold hover:text-white transition-colors">
            Go to dashboard
          </button>
        </div>
      </PageWrapper>
    );
  }

  const filtered = requests.filter((r) => r.status === tab);

  const tabs: Tab[] = ["pending", "approved", "rejected"];
  const tabLabels: Record<Tab, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
  const tabCounts: Record<Tab, number> = {
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  };

  return (
    <PageWrapper>
      {/* Header */}
      <div className="flex items-center space-x-4 mb-10">
        <button onClick={() => navigate("/dashboard")} className="p-2 -ml-2 text-zinc-500">
          <ArrowLeft size={24} />
        </button>
        <div>
          <h2 className="text-2xl font-serif italic text-white/90">Admin Panel</h2>
          <p className="text-[10px] uppercase tracking-widest text-text-muted font-bold mt-0.5">Custom Room Requests</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8 p-1.5 bg-card rounded-2xl border border-white/5">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all flex items-center justify-center gap-1.5 ${
              tab === t ? "bg-accent text-zinc-950 shadow-md" : "text-text-muted hover:text-white"
            }`}
          >
            {tabLabels[t]}
            {tabCounts[t] > 0 && (
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black ${
                tab === t ? "bg-zinc-950/20" : "bg-white/10"
              }`}>
                {tabCounts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Request List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <div key={i} className="h-24 bg-card rounded-[2rem] animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-text-muted italic text-sm py-8 text-center">No {tab} requests.</p>
      ) : (
        <div className="space-y-4">
          {filtered.map((req) => {
            const isExpanded = expandedId === req.id;
            return (
              <motion.div
                key={req.id}
                layout
                className="bg-card border border-white/5 rounded-[2rem] overflow-hidden"
              >
                {/* Summary Row */}
                <button
                  className="w-full p-5 flex items-start gap-4 text-left hover:bg-white/[0.02] transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : req.id)}
                >
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 mt-0.5 ${
                    req.status === "pending" ? "bg-accent/10 text-accent" :
                    req.status === "approved" ? "bg-green-500/10 text-green-400" :
                    "bg-red-500/10 text-red-400"
                  }`}>
                    {req.status === "pending" ? <Clock size={18} /> : req.status === "approved" ? <Check size={18} /> : <X size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif italic text-white/90 text-lg truncate">{req.eventTitle}</h3>
                    <p className="text-xs text-text-muted mt-0.5 truncate">{req.email}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1 text-[10px] text-text-muted">
                        <Users size={10} /> {req.guestCount} guests
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-text-muted">
                        <Camera size={10} /> {req.shotsPerPerson} shots
                      </span>
                      <span className="text-[10px] text-text-muted">
                        {formatDistanceToNow(req.createdAt.toDate(), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    className={`text-zinc-700 transition-transform shrink-0 mt-1 ${isExpanded ? "rotate-90" : ""}`}
                  />
                </button>

                {/* Expanded Detail */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5 space-y-5 border-t border-white/5 pt-4">
                        {/* Detail grid */}
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: "Requester UID", value: req.uid },
                            { label: "Email", value: req.email },
                            { label: "Guests", value: String(req.guestCount) },
                            { label: "Shots / Guest", value: String(req.shotsPerPerson) },
                            { label: "Event Starts", value: format(req.startsAt.toDate(), "MMM d, yyyy h:mm a") },
                            { label: "Reveal At", value: format(req.revealAt.toDate(), "MMM d, yyyy h:mm a") },
                          ].map(({ label, value }) => (
                            <div key={label} className="space-y-0.5">
                              <p className="text-[9px] uppercase tracking-widest text-text-muted font-bold">{label}</p>
                              <p className="text-xs text-white/80 font-medium break-all">{value}</p>
                            </div>
                          ))}
                        </div>

                        {req.status === "approved" && req.galleryId && (
                          <div className="p-3 bg-green-500/5 border border-green-500/20 rounded-xl">
                            <p className="text-[10px] text-green-400 font-bold uppercase tracking-wider">Gallery Created</p>
                            <p className="text-xs text-white/60 mt-0.5 break-all">{req.galleryId}</p>
                          </div>
                        )}

                        {req.adminNote && (
                          <div className="p-3 bg-white/5 border border-white/5 rounded-xl">
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-wider mb-1">Admin Note</p>
                            <p className="text-xs text-white/70">{req.adminNote}</p>
                          </div>
                        )}

                        {/* Actions — only for pending */}
                        {req.status === "pending" && (
                          <div className="space-y-3">
                            <textarea
                              placeholder="Optional note (visible to you only)..."
                              value={adminNote}
                              onChange={(e) => setAdminNote(e.target.value)}
                              className="w-full bg-transparent border border-white/10 rounded-2xl p-3 text-xs text-white/80 outline-none focus:border-accent resize-none h-16 placeholder:text-white/20"
                            />
                            <div className="flex gap-3">
                              <button
                                onClick={() => handleReject(req)}
                                disabled={!!actionLoading}
                                className="flex-1 py-3 rounded-2xl border border-red-500/30 text-red-400 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                              >
                                <X size={14} />
                                {actionLoading === req.id ? "..." : "Reject"}
                              </button>
                              <button
                                onClick={() => handleApprove(req)}
                                disabled={!!actionLoading}
                                className="flex-1 py-3 rounded-2xl bg-accent text-zinc-950 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-accent/90 transition-colors disabled:opacity-40 shadow-lg shadow-accent/10"
                              >
                                <Check size={14} />
                                {actionLoading === req.id ? "Creating..." : "Approve & Create"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </PageWrapper>
  );
}
