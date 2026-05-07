import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatForVoice, buildTtsText } from "../src/services/scheduler/voice-format";

// ─── voice-format unit tests ────────────────────────────────────────────────

describe("formatForVoice", () => {
  it("strips markdown bold", () => {
    expect(formatForVoice("Hello **world**")).toBe("Hello world");
  });

  it("strips markdown italic", () => {
    expect(formatForVoice("Hello *world*")).toBe("Hello world");
  });

  it("strips markdown headers", () => {
    expect(formatForVoice("## Section Title\nContent")).toBe("Section Title\nContent");
  });

  it("strips markdown links, keeps label", () => {
    expect(formatForVoice("Click [here](https://example.com) to proceed.")).toBe(
      "Click here to proceed."
    );
  });

  it("strips inline code backticks", () => {
    expect(formatForVoice("Run `npm install`")).toBe("Run npm install");
  });

  it("replaces URLs with 'a secure link'", () => {
    expect(formatForVoice("Visit https://example.com/path?q=1 for details.")).toBe(
      "Visit a secure link for details."
    );
  });

  it("spells out booking codes", () => {
    expect(formatForVoice("Your code is NL-A742.")).toBe(
      "Your code is N L dash A 7 4 2."
    );
  });

  it("handles multiple booking codes", () => {
    const input = "Codes: AB-C123 and XY-Z999.";
    const result = formatForVoice(input);
    expect(result).toContain("A B dash C 1 2 3");
    expect(result).toContain("X Y dash Z 9 9 9");
  });

  it("collapses triple newlines", () => {
    expect(formatForVoice("A\n\n\n\nB")).toBe("A\n\nB");
  });

  it("strips list bullets", () => {
    expect(formatForVoice("- Item one\n* Item two")).toBe("Item one\nItem two");
  });

  it("strips numbered list prefixes", () => {
    expect(formatForVoice("1. First\n2. Second")).toBe("First\nSecond");
  });
});

describe("buildTtsText", () => {
  it("includes voice formatting", () => {
    expect(buildTtsText("**Bold** code NL-A742")).toBe("Bold code N L dash A 7 4 2");
  });

  it("formats times for speech — removes :00 minutes", () => {
    expect(buildTtsText("Slot at 4:00 PM IST")).toBe("Slot at 4 PM IST");
  });

  it("keeps non-zero minutes in time formatting", () => {
    expect(buildTtsText("Slot at 4:30 PM IST")).toBe("Slot at 4 30 PM IST");
  });

  it("handles full response with markdown, code, URL, and time", () => {
    const input = [
      "## Your Booking",
      "**Code**: NL-A742",
      "**Slot**: 4:00 PM IST",
      "",
      "Submit details at https://example.com/secure/abc123"
    ].join("\n");

    const result = buildTtsText(input);
    expect(result).not.toContain("**");
    expect(result).not.toContain("##");
    expect(result).not.toContain("https://");
    expect(result).toContain("N L dash A 7 4 2");
    expect(result).toContain("4 PM IST");
    expect(result).toContain("a secure link");
  });
});

// ─── Deepgram adapter (mock fetch) ─────────────────────────────────────────

describe("Deepgram adapter", () => {
  beforeEach(() => {
    vi.stubEnv("DEEPGRAM_API_KEY", "test-key");
    vi.restoreAllMocks();
  });

  it("transcribeAudio sends correct request and parses response", async () => {
    const mockResponse = {
      results: {
        channels: [{
          alternatives: [{
            transcript: "book an advisor call",
            confidence: 0.95,
            words: [
              { word: "book", start: 0, end: 0.3, confidence: 0.98 },
              { word: "an", start: 0.3, end: 0.4, confidence: 0.99 },
              { word: "advisor", start: 0.4, end: 0.8, confidence: 0.93 },
              { word: "call", start: 0.8, end: 1.0, confidence: 0.97 }
            ]
          }]
        }]
      }
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const { transcribeAudio } = await import("../src/adapters/deepgram/index");
    const result = await transcribeAudio(Buffer.from("fake-audio"), { mimeType: "audio/webm" });

    expect(result.transcript).toBe("book an advisor call");
    expect(result.confidence).toBe(0.95);
    expect(result.words).toHaveLength(4);
    expect(fetchSpy).toHaveBeenCalledOnce();

    const callUrl = fetchSpy.mock.calls[0][0] as string;
    expect(callUrl).toContain("api.deepgram.com/v1/listen");
    expect(callUrl).toContain("model=nova-2");
    expect(callUrl).toContain("language=en-IN");
  });

  it("transcribeAudio throws on missing API key", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    vi.resetModules();
    const { transcribeAudio } = await import("../src/adapters/deepgram/index");
    await expect(transcribeAudio(Buffer.from("audio"))).rejects.toThrow("DEEPGRAM_API_KEY");
  });

  it("synthesizeSpeech sends correct request and returns base64", async () => {
    const fakeAudioBytes = new Uint8Array([0x49, 0x44, 0x33]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(fakeAudioBytes, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" }
      })
    );

    const { synthesizeSpeech } = await import("../src/adapters/deepgram/index");
    const result = await synthesizeSpeech("Hello world");

    expect(result.audioBase64).toBeTruthy();
    expect(result.contentType).toBe("audio/mpeg");
    expect(Buffer.from(result.audioBase64, "base64")).toEqual(Buffer.from(fakeAudioBytes));
  });

  it("synthesizeSpeech throws on missing API key", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    vi.resetModules();
    const { synthesizeSpeech } = await import("../src/adapters/deepgram/index");
    await expect(synthesizeSpeech("Hello")).rejects.toThrow("DEEPGRAM_API_KEY");
  });
});
