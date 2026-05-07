"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  Calendar,
  FileSpreadsheet,
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  UserPlus,
  User
} from "lucide-react";

import { HitlActionRecord, HitlStatus } from "@/services/scheduler/types";

type CustomerDetails = {
  submitted: boolean;
  customer_email?: string;
  customer_name?: string | null;
};

type FilterTab = "all" | HitlStatus;

const TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" }
];

const statusStyles: Record<string, { bg: string; text: string; icon: typeof Clock }> = {
  pending: { bg: "bg-warning/10", text: "text-warning", icon: Clock },
  approved: { bg: "bg-success/10", text: "text-success", icon: CheckCircle2 },
  rejected: { bg: "bg-danger/10", text: "text-danger", icon: XCircle },
  executed: { bg: "bg-info/10", text: "text-info", icon: CheckCircle2 },
  failed: { bg: "bg-danger/10", text: "text-danger", icon: AlertCircle }
};

function IntegrationPill({ label, status }: { label: string; status: string }) {
  const ok = status === "created" || status === "updated" || status === "sent";
  const failed = status === "failed";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
      ok ? "bg-success/10 text-success" : failed ? "bg-danger/10 text-danger" : "bg-muted/10 text-muted"
    }`}>
      {label === "Calendar" && <Calendar className="w-3 h-3" />}
      {label === "Sheet" && <FileSpreadsheet className="w-3 h-3" />}
      {label === "Email" && <Mail className="w-3 h-3" />}
      {label}: {status}
    </span>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

export function HitlApprovalClient() {
  const [actions, setActions] = useState<HitlActionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [marketThemes, setMarketThemes] = useState<string[]>([]);
  const [customerDetails, setCustomerDetails] = useState<Record<string, CustomerDetails>>({});
  const [attendeeLoading, setAttendeeLoading] = useState<Record<string, boolean>>({});
  const [emailPreviews, setEmailPreviews] = useState<Record<string, Record<string, unknown>>>({});
  const [emailPreviewOpen, setEmailPreviewOpen] = useState<Record<string, "advisor" | "customer" | null>>({});
  const [sendingEmail, setSendingEmail] = useState<Record<string, boolean>>({});

  async function loadActions() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/hitl");
      const data = (await response.json()) as { actions?: HitlActionRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Failed to load HITL actions.");
      setActions(data.actions ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadMarketContext() {
    try {
      const r = await fetch("/api/admin/review-pulse");
      const d = await r.json();
      if (d.pulse?.top_customer_themes) {
        setMarketThemes(d.pulse.top_customer_themes);
      }
    } catch {
      /* non-critical */
    }
  }

  async function loadCustomerDetails(actionId: string) {
    try {
      const r = await fetch(`/api/admin/hitl/${actionId}/secure-details`);
      const d = (await r.json()) as CustomerDetails;
      setCustomerDetails((prev) => ({ ...prev, [actionId]: d }));
    } catch {
      /* non-critical */
    }
  }

  async function addAttendee(actionId: string) {
    setAttendeeLoading((prev) => ({ ...prev, [actionId]: true }));
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/hitl/${actionId}/add-attendee`, {
        method: "POST"
      });
      const data = (await response.json()) as { error?: string; customer_attendee_added?: boolean };
      if (!response.ok) {
        setError(data.error ?? "Failed to add attendee.");
        return;
      }
      setMessage(`Customer added to calendar for ${data.customer_attendee_added ? "booking" : "pending"}.`);
      await loadActions();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAttendeeLoading((prev) => ({ ...prev, [actionId]: false }));
    }
  }

  async function loadEmailPreview(actionId: string) {
    try {
      const r = await fetch(`/api/admin/hitl/${actionId}/email-preview`);
      const d = await r.json();
      setEmailPreviews((prev) => ({ ...prev, [actionId]: d }));
    } catch { /* non-critical */ }
  }

  async function handleSendEmail(actionId: string, target: "advisor" | "customer") {
    const key = `${actionId}-${target}`;
    setSendingEmail((prev) => ({ ...prev, [key]: true }));
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/hitl/${actionId}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? `Failed to send ${target} email.`);
        return;
      }
      setMessage(`${target === "advisor" ? "Advisor" : "Customer"} email sent successfully.`);
      await loadActions();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSendingEmail((prev) => ({ ...prev, [key]: false }));
    }
  }

  useEffect(() => {
    loadActions();
    loadMarketContext();
  }, []);

  useEffect(() => {
    for (const action of actions) {
      if (!customerDetails[action.id]) {
        loadCustomerDetails(action.id);
      }
    }
  }, [actions]);

  const filtered = filter === "all" ? actions : actions.filter((a) => a.status === filter);
  const counts = {
    all: actions.length,
    pending: actions.filter((a) => a.status === "pending").length
  };

  return (
    <motion.div
      className="space-y-6"
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
    >
      <motion.div variants={fadeUp}>
        <h1
          className="text-[clamp(1.8rem,4vw,2.8rem)] font-[520] tracking-[-0.03em] leading-tight"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
        >
          HITL Approval Center
        </h1>
        <p className="mt-1 text-muted text-sm">
          Review pending booking actions. Calendar attendees are added only after secure details + admin approval.
        </p>
      </motion.div>

      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-success/5 border border-success/20 text-success rounded-xl p-3 text-sm font-semibold flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {message}
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-danger/5 border border-danger/20 text-danger rounded-xl p-3 text-sm font-semibold flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={fadeUp} className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`!rounded-full !text-sm !font-semibold !px-4 !py-2 transition-all ${
              filter === tab.key
                ? "!bg-accent !text-white"
                : "!bg-card-soft !text-muted hover:!text-foreground"
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-80">
              {counts[tab.key as keyof typeof counts] ?? 0}
            </span>
          </button>
        ))}
      </motion.div>

      {loading ? (
        <div className="flex items-center gap-3 text-muted py-10">
          <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          Loading actions...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <ShieldCheck className="w-8 h-8 text-muted mx-auto mb-3" />
          <p className="text-sm text-muted">No {filter === "all" ? "" : filter} actions found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((action) => {
            const sty = statusStyles[action.status] ?? statusStyles.pending;
            const StatusIcon = sty.icon;
            const isExpanded = expandedId === action.id;
            const payload = action.payload ?? {};

            return (
              <motion.article
                key={action.id}
                variants={fadeUp}
                layout
                className="bg-card border border-border rounded-2xl overflow-hidden"
              >
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <code className="text-lg font-extrabold tracking-wide text-foreground">
                        {action.booking_code}
                      </code>
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${sty.bg} ${sty.text}`}>
                        <StatusIcon className="w-3 h-3" />
                        {action.status}
                      </span>
                    </div>
                    <span className="text-xs text-muted shrink-0">
                      {action.action_type} → {action.target_booking_status}
                    </span>
                  </div>

                  <div className="grid sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-muted block">Topic</span>
                      <span className="font-semibold text-foreground">{payload.topic as string ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted block">Slot</span>
                      <span className="font-semibold text-foreground">
                        {payload.slot_label as string ?? payload.slot_start as string ?? "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-muted block">Input Mode</span>
                      <span className="font-semibold text-foreground">{payload.input_mode as string ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted block">Created</span>
                      <span className="font-semibold text-foreground">
                        {action.created_at ? new Date(action.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <IntegrationPill label="Calendar" status={action.calendar_status} />
                    <IntegrationPill label="Sheet" status={action.sheet_status} />
                    <IntegrationPill label="Email" status={action.email_draft_status} />
                  </div>

                  {(() => {
                    const cd = customerDetails[action.id];
                    const isApproved = action.status === "executed" || action.status === "approved";
                    const alreadyAdded = Boolean(payload.customer_attendee_added);
                    const canAddAttendee = cd?.submitted && isApproved && !alreadyAdded && payload.calendar_status !== "failed";
                    return (
                      <div className={`rounded-xl p-3 border ${cd?.submitted ? "bg-success/5 border-success/20" : "bg-card-soft border-border/50"}`}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <User className="w-3.5 h-3.5 text-muted" />
                          <span className="text-xs font-bold text-muted">Customer Details</span>
                        </div>
                        {cd?.submitted ? (
                          <div className="space-y-1.5">
                            <div className="grid sm:grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-xs text-muted block">Email</span>
                                <span className="font-semibold text-foreground">{cd.customer_email}</span>
                              </div>
                              <div>
                                <span className="text-xs text-muted block">Name</span>
                                <span className="font-semibold text-foreground">{cd.customer_name || "—"}</span>
                              </div>
                            </div>
                            {alreadyAdded && (
                              <span className="inline-flex items-center gap-1 text-xs font-bold text-success">
                                <CheckCircle2 className="w-3 h-3" />
                                Added to calendar
                              </span>
                            )}
                            {canAddAttendee && (
                              <button
                                type="button"
                                onClick={() => addAttendee(action.id)}
                                disabled={attendeeLoading[action.id]}
                                className="!bg-accent !text-white !font-bold !px-4 !py-1.5 !rounded-full !text-xs hover:!opacity-90 flex items-center gap-1.5 mt-1"
                              >
                                <UserPlus className="w-3 h-3" />
                                {attendeeLoading[action.id] ? "Adding..." : "Add Customer to Calendar"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted italic">Awaiting customer details</span>
                        )}
                      </div>
                    );
                  })()}

                  {marketThemes.length > 0 && (
                    <div className="bg-info/5 border border-info/15 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-info" />
                        <span className="text-xs font-bold text-info">Market Context (from Review Pulse)</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {marketThemes.map((t) => (
                          <span key={t} className="bg-info/10 text-info text-xs font-semibold px-2 py-0.5 rounded-full">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {(() => {
                    const isApprovedOrExecuted = action.status === "executed" || action.status === "approved";
                    const preview = emailPreviews[action.id];
                    const currentPreview = emailPreviewOpen[action.id];
                    const advisorDraft = preview?.advisor as Record<string, string> | undefined;
                    const customerDraft = preview?.customer as Record<string, string> | undefined;

                    return (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!preview) loadEmailPreview(action.id);
                              setEmailPreviewOpen((prev) => ({
                                ...prev,
                                [action.id]: currentPreview === "advisor" ? null : "advisor"
                              }));
                            }}
                            className="!bg-transparent !p-0 !text-xs !font-semibold !text-accent hover:!text-accent/80 !shadow-none flex items-center gap-1"
                          >
                            <Mail className="w-3 h-3" />
                            {currentPreview === "advisor" ? "Hide" : "Preview"} Advisor Email
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!preview) loadEmailPreview(action.id);
                              setEmailPreviewOpen((prev) => ({
                                ...prev,
                                [action.id]: currentPreview === "customer" ? null : "customer"
                              }));
                            }}
                            className="!bg-transparent !p-0 !text-xs !font-semibold !text-accent hover:!text-accent/80 !shadow-none flex items-center gap-1"
                          >
                            <Mail className="w-3 h-3" />
                            {currentPreview === "customer" ? "Hide" : "Preview"} Customer Email
                          </button>
                        </div>

                        <AnimatePresence>
                          {currentPreview && preview && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="bg-card-soft border border-border rounded-xl p-3 text-sm space-y-1"
                            >
                              {currentPreview === "advisor" && advisorDraft && (
                                <>
                                  <div><span className="text-xs text-muted">To:</span> <span className="font-semibold">{advisorDraft.to}</span></div>
                                  <div><span className="text-xs text-muted">Subject:</span> <span className="font-semibold">{advisorDraft.subject}</span></div>
                                  <pre className="text-xs text-muted whitespace-pre-wrap mt-2">{advisorDraft.body}</pre>
                                </>
                              )}
                              {currentPreview === "advisor" && !advisorDraft && (
                                <span className="text-xs text-muted italic">No advisor draft available.</span>
                              )}
                              {currentPreview === "customer" && customerDraft && (
                                <>
                                  <div><span className="text-xs text-muted">To:</span> <span className="font-semibold">{customerDraft.to}</span></div>
                                  <div><span className="text-xs text-muted">Subject:</span> <span className="font-semibold">{customerDraft.subject}</span></div>
                                  <pre className="text-xs text-muted whitespace-pre-wrap mt-2">{customerDraft.body}</pre>
                                </>
                              )}
                              {currentPreview === "customer" && !customerDraft && (
                                <span className="text-xs text-muted italic">No customer draft available.</span>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {isApprovedOrExecuted && (
                          <div className="flex flex-wrap gap-2">
                            {advisorDraft && action.email_draft_status !== "sent" && (
                              <button
                                type="button"
                                onClick={() => handleSendEmail(action.id, "advisor")}
                                disabled={sendingEmail[`${action.id}-advisor`]}
                                className="!bg-accent !text-white !font-bold !px-4 !py-1.5 !rounded-full !text-xs hover:!opacity-90 flex items-center gap-1.5"
                              >
                                <Mail className="w-3 h-3" />
                                {sendingEmail[`${action.id}-advisor`] ? "Sending..." : "Send Advisor Email"}
                              </button>
                            )}
                            {action.email_draft_status === "sent" && (
                              <span className="inline-flex items-center gap-1 text-xs font-bold text-success">
                                <CheckCircle2 className="w-3 h-3" /> Advisor email sent
                              </span>
                            )}
                            {customerDraft && (
                              <button
                                type="button"
                                onClick={() => handleSendEmail(action.id, "customer")}
                                disabled={sendingEmail[`${action.id}-customer`]}
                                className="!bg-accent !text-white !font-bold !px-4 !py-1.5 !rounded-full !text-xs hover:!opacity-90 flex items-center gap-1.5"
                              >
                                <Mail className="w-3 h-3" />
                                {sendingEmail[`${action.id}-customer`] ? "Sending..." : "Send Customer Email"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : action.id)}
                    className="!bg-transparent !p-0 !text-xs !font-semibold !text-muted hover:!text-foreground !shadow-none flex items-center gap-1"
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {isExpanded ? "Hide" : "Show"} full payload
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.pre
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="bg-[#0d1726] text-white text-xs rounded-xl p-4 overflow-auto"
                      >
                        {JSON.stringify(action.payload, null, 2)}
                      </motion.pre>
                    )}
                  </AnimatePresence>

                </div>
              </motion.article>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
