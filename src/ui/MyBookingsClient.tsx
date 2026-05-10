"use client";

import { FormEvent, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  Loader2
} from "lucide-react";
import { notifyCustomerPendingBookingsChanged } from "@/lib/customer-pending-bookings";

type BookingSummary = {
  id: string;
  booking_code: string;
  topic: string;
  slot_start: string;
  slot_end: string;
  status: string;
  input_mode: string;
  secure_link_submitted: boolean;
  calendar_status: string;
  created_at: string;
};

const statusConfig: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending_admin_confirmation: { label: "Pending Approval", color: "text-warning", icon: Clock },
  confirmed: { label: "Confirmed", color: "text-success", icon: CheckCircle2 },
  rescheduled: { label: "Rescheduled", color: "text-info", icon: Calendar },
  reschedule_requested: { label: "Reschedule Pending", color: "text-warning", icon: Clock },
  cancel_requested: { label: "Cancel Pending", color: "text-warning", icon: Clock },
  cancelled: { label: "Cancelled", color: "text-danger", icon: XCircle },
  rejected: { label: "Rejected", color: "text-danger", icon: XCircle }
};

function formatSlot(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  });
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

export function MyBookingsClient() {
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsFormOpen, setDetailsFormOpen] = useState<string | null>(null);

  async function loadBookings() {
    setLoading(true);
    try {
      const r = await fetch("/api/customer/my-bookings");
      const d = (await r.json()) as { bookings?: BookingSummary[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Failed to load bookings.");
      setBookings(d.bookings ?? []);
      notifyCustomerPendingBookingsChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBookings();
  }, []);

  return (
    <motion.div
      className="max-w-3xl mx-auto p-4 md:p-8 space-y-6"
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
    >
      <motion.div variants={fadeUp}>
        <h1
          className="text-[clamp(1.6rem,4vw,2.4rem)] font-[520] tracking-[-0.03em] leading-tight"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--ink-soft)" }}
        >
          My Bookings
        </h1>
        <p className="mt-1 text-muted text-sm">
          View your advisor bookings and complete your details.
        </p>
      </motion.div>

      {error && (
        <div className="bg-danger/5 border border-danger/20 text-danger rounded-xl p-3 text-sm font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-3 text-muted py-10">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading bookings...
        </div>
      ) : bookings.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <FileText className="w-8 h-8 text-muted mx-auto mb-3" />
          <p className="text-sm text-muted">No bookings found. Use the Scheduler to book an advisor session.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => {
            const sc = statusConfig[booking.status] ?? statusConfig.pending_admin_confirmation;
            const StatusIcon = sc.icon;
            const showForm = detailsFormOpen === booking.id && !booking.secure_link_submitted;

            return (
              <motion.article
                key={booking.id}
                variants={fadeUp}
                layout
                className="bg-card border border-border rounded-2xl overflow-hidden"
              >
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <code className="text-lg font-extrabold tracking-wide text-foreground">
                        {booking.booking_code}
                      </code>
                      <span className={`inline-flex items-center gap-1 text-xs font-bold ${sc.color}`}>
                        <StatusIcon className="w-3 h-3" />
                        {sc.label}
                      </span>
                    </div>
                    <span className="text-xs text-muted shrink-0">{booking.input_mode}</span>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-xs text-muted block">Topic</span>
                      <span className="font-semibold text-foreground">{booking.topic}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted block">Slot</span>
                      <span className="font-semibold text-foreground">{formatSlot(booking.slot_start)}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted block">Booked</span>
                      <span className="font-semibold text-foreground">{formatSlot(booking.created_at)}</span>
                    </div>
                  </div>

                  {booking.secure_link_submitted ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-success">
                      <CheckCircle2 className="w-3 h-3" />
                      Details submitted
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDetailsFormOpen(showForm ? null : booking.id)}
                      className="!bg-accent !text-white !font-bold !px-4 !py-1.5 !rounded-full !text-xs hover:!opacity-90"
                    >
                      Complete Details
                    </button>
                  )}

                  <AnimatePresence>
                    {showForm && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                      >
                        <InlineSecureDetailsForm
                          bookingCode={booking.booking_code}
                          onComplete={() => {
                            setDetailsFormOpen(null);
                            loadBookings();
                          }}
                        />
                      </motion.div>
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

function InlineSecureDetailsForm({
  bookingCode,
  onComplete
}: {
  bookingCode: string;
  onComplete: () => void;
}) {
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch(`/api/customer/my-bookings/${encodeURIComponent(bookingCode)}/secure-details`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_email: customerEmail,
          customer_name: customerName
        })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Failed to submit.");
      setSuccess(true);
      setTimeout(onComplete, 1500);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="bg-success/5 border border-success/20 text-success rounded-xl p-3 text-sm font-semibold flex items-center gap-2 mt-2">
        <CheckCircle2 className="w-4 h-4" />
        Details submitted for {bookingCode}.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="bg-card-soft border border-border rounded-xl p-4 mt-2 space-y-3">
      <p className="text-xs text-muted">
        Complete your details for booking <strong>{bookingCode}</strong>. Your information is encrypted and used only for the calendar invite.
      </p>
      {formError && (
        <div className="text-xs text-danger font-semibold">{formError}</div>
      )}
      <div>
        <label className="text-xs font-semibold text-muted block mb-1">Email for calendar invite</label>
        <input
          type="email"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          required
          className="w-full !bg-card !border !border-border !rounded-lg !px-3 !py-2 !text-sm !text-foreground"
        />
      </div>
      <div>
        <label className="text-xs font-semibold text-muted block mb-1">Name for calendar invite</label>
        <input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
          className="w-full !bg-card !border !border-border !rounded-lg !px-3 !py-2 !text-sm !text-foreground"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="!bg-accent !text-white !font-bold !px-5 !py-2 !rounded-full !text-sm hover:!opacity-90"
      >
        {submitting ? "Submitting..." : "Submit Details"}
      </button>
    </form>
  );
}
