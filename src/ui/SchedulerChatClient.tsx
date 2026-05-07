"use client";

import { FormEvent, useEffect, useState } from "react";

import { SchedulerOutput, SchedulerSessionContext } from "@/services/scheduler/types";

type Message = {
  role: "assistant" | "user";
  text: string;
};

export function SchedulerChatClient() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [context, setContext] = useState<SchedulerSessionContext | undefined>();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/scheduler/message?mode=chat")
      .then(async (response) => {
        const data = (await response.json()) as SchedulerOutput & { error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to start scheduler.");
        }
        if (mounted) {
          setMessages([{ role: "assistant", text: data.response_text }]);
          setContext(data.context);
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || loading) {
      return;
    }

    setText("");
    setMessages((current) => [...current, { role: "user", text: trimmed }]);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/scheduler/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, input_mode: "chat", context })
      });
      const data = (await response.json()) as SchedulerOutput & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Scheduler request failed.");
      }
      setContext(data.context);
      setMessages((current) => [...current, { role: "assistant", text: data.response_text }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="module-card">
      <span>Customer Module</span>
      <h1>Advisor Scheduler</h1>
      <p className="muted">
        Book, reschedule, cancel, check availability, or ask what to prepare. Do not share
        personal details in chat; secure details are collected only through the booking link.
      </p>

      <div className="chat-window" aria-live="polite">
        {messages.map((message, index) => (
          <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
            <strong>{message.role === "assistant" ? "Scheduler" : "You"}</strong>
            <p>{message.text}</p>
          </article>
        ))}
        {loading ? <p className="muted">Working...</p> : null}
      </div>

      {error ? <p className="error-banner">{error}</p> : null}

      <form className="chat-form" onSubmit={onSubmit}>
        <label htmlFor="scheduler-message">Message</label>
        <textarea
          id="scheduler-message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Example: I want to book an advisor call"
          rows={3}
        />
        <button type="submit" disabled={loading}>
          Send
        </button>
      </form>
    </section>
  );
}
