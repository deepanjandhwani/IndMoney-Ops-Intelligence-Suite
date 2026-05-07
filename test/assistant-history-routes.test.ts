import { describe, expect, it, vi, beforeEach } from "vitest";

import { POST as appendPost } from "../app/api/assistant/history/append/route";
import { GET as sessionsListGet } from "../app/api/assistant/history/sessions/route";
import * as historyLib from "../app/api/assistant/history/_lib";

vi.mock("../app/api/assistant/history/_lib", async (importOriginal) => {
  const actual = await importOriginal<typeof historyLib>();
  return {
    ...actual,
    getAssistantHistoryRepository: vi.fn()
  };
});

describe("assistant history API routes", () => {
  beforeEach(() => {
    vi.mocked(historyLib.getAssistantHistoryRepository).mockReset();
  });

  it("append returns 400 when device_id is missing", async () => {
    vi.mocked(historyLib.getAssistantHistoryRepository).mockReturnValue({
      ensureSession: vi.fn(),
      appendEvent: vi.fn()
    } as never);

    const response = await appendPost(
      new Request("http://localhost/api/assistant/history/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: { role: "user", lane: "assistant", kind: "faq_question", content: "Hi" }
        })
      })
    );

    expect(response.status).toBe(400);
  });

  it("append returns 400 when device_id is missing", async () => {
    const response = await appendPost(
      new Request("http://localhost/api/assistant/history/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: { role: "user", lane: "assistant", kind: "faq_question", content: "Hi" }
        })
      })
    );

    expect(response.status).toBe(400);
  });

  it("append masks PAN-like content before persisting", async () => {
    const appendEvent = vi.fn().mockResolvedValue(1);
    const ensureSession = vi.fn().mockResolvedValue("sess-1");
    vi.mocked(historyLib.getAssistantHistoryRepository).mockReturnValue({
      ensureSession,
      appendEvent
    } as never);

    const response = await appendPost(
      new Request("http://localhost/api/assistant/history/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: "device-1",
          session_id: "sess-1",
          event: {
            role: "user",
            lane: "assistant",
            kind: "faq_question",
            content: "my pan is ABCDE1234F"
          }
        })
      })
    );

    expect(response.status).toBe(200);
    expect(appendEvent).toHaveBeenCalled();
    const payload = appendEvent.mock.calls[0][2] as { content: string; pii_masked: boolean };
    expect(payload.content.toUpperCase()).not.toContain("ABCDE1234F");
    expect(payload.pii_masked).toBe(true);
  });

  it("sessions list returns 400 when device_id is missing", async () => {
    const response = await sessionsListGet(
      new Request("http://localhost/api/assistant/history/sessions")
    );
    expect(response.status).toBe(400);
  });
});
