const DEEPGRAM_STT_URL = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_TTS_URL = "https://api.deepgram.com/v1/speak";

const STT_TIMEOUT_MS = 10_000;
const TTS_TIMEOUT_MS = 10_000;

export type SttResult = {
  transcript: string;
  confidence: number;
  words: Array<{ word: string; start: number; end: number; confidence: number }>;
};

export type TtsResult = {
  audioBase64: string;
  contentType: string;
};

export async function transcribeAudio(
  audioBuffer: Buffer | Uint8Array,
  options: { mimeType?: string; language?: string; model?: string } = {}
): Promise<SttResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }

  const params = new URLSearchParams({
    model: options.model ?? "nova-2",
    language: options.language ?? "en-IN",
    punctuate: "true",
    smart_format: "true",
    keywords: [
      "KYC:2", "SIP:2", "nominee:2", "mandate:2", "Groww:3",
      "onboarding:2", "withdrawal:2", "rescheduling:2"
    ].join("&keywords=")
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

  try {
    const response = await fetch(`${DEEPGRAM_STT_URL}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": options.mimeType ?? "audio/webm"
      },
      body: new Blob([new Uint8Array(audioBuffer)]),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Deepgram STT error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{
            transcript?: string;
            confidence?: number;
            words?: Array<{ word: string; start: number; end: number; confidence: number }>;
          }>;
        }>;
      };
    };

    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    return {
      transcript: alt?.transcript ?? "",
      confidence: alt?.confidence ?? 0,
      words: alt?.words ?? []
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeSpeech(
  text: string,
  options: { model?: string; encoding?: string; sampleRate?: number } = {}
): Promise<TtsResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }

  const encoding = options.encoding ?? "mp3";
  const params = new URLSearchParams({
    model: options.model ?? "aura-asteria-en",
    encoding
  });
  if (encoding !== "mp3" && options.sampleRate) {
    params.set("sample_rate", String(options.sampleRate));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

  try {
    const response = await fetch(`${DEEPGRAM_TTS_URL}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Deepgram TTS error ${response.status}: ${body}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      audioBase64,
      contentType: response.headers.get("content-type") ?? "audio/mpeg"
    };
  } finally {
    clearTimeout(timer);
  }
}
