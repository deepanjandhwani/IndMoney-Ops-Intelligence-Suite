"use client";

import { FormEvent, useState } from "react";

type SecureDetailsClientProps = {
  token: string;
};

export function SecureDetailsClient({ token }: SecureDetailsClientProps) {
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const response = await fetch("/api/scheduler/secure-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          customer_email: customerEmail,
          customer_name: customerName
        })
      });
      const data = (await response.json()) as {
        booking_code?: string;
        attendee_added?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not submit secure details.");
      }
      setStatus(
        data.attendee_added
          ? `Details received for ${data.booking_code}. The calendar attendee was added because Admin approval was already complete.`
          : `Details received for ${data.booking_code}. Final confirmation still requires Admin approval.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="module-card">
      <span>Secure Details</span>
      <h1>Complete Booking Details</h1>
      <p className="muted">
        This form is outside the AI chat. Details are encrypted at rest and used only after Admin
        approval to add the customer attendee to the advisor calendar hold.
      </p>

      <form className="chat-form" onSubmit={onSubmit}>
        <label htmlFor="customer-email">Email for calendar invite</label>
        <input
          id="customer-email"
          type="email"
          value={customerEmail}
          onChange={(event) => setCustomerEmail(event.target.value)}
          required
        />

        <label htmlFor="customer-name">Name for calendar invite</label>
        <input
          id="customer-name"
          value={customerName}
          onChange={(event) => setCustomerName(event.target.value)}
          required
        />

        <button type="submit" disabled={loading}>
          Submit Secure Details
        </button>
      </form>

      {status ? <p className="status-banner">{status}</p> : null}
    </section>
  );
}
