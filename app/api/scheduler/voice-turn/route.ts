import { NextRequest, NextResponse } from "next/server";

import { transcribeAudio, synthesizeSpeech } from "@/adapters/deepgram/index";
import { processSchedulerMessage } from "@/services/scheduler/state-machine";
import { createSchedulerDeps } from "@/services/scheduler/server";
import { buildTtsText } from "@/services/scheduler/voice-format";
import type { SchedulerSessionContext } from "@/services/scheduler/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const contextJson = formData.get("context") as string | null;

    if (!audioFile) {
      return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
    }

    const context: SchedulerSessionContext | undefined = contextJson
      ? (JSON.parse(contextJson) as SchedulerSessionContext)
      : undefined;

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

    let transcript: string;
    let sttConfidence: number;
    try {
      const sttResult = await transcribeAudio(audioBuffer, {
        mimeType: audioFile.type || "audio/webm"
      });
      transcript = sttResult.transcript;
      sttConfidence = sttResult.confidence;
    } catch (sttError) {
      console.error("[voice-turn] STT failed:", sttError);
      return NextResponse.json(
        {
          error: "Speech recognition failed. Please try again or switch to text input.",
          fallback_to_text: true
        },
        { status: 502 }
      );
    }

    if (!transcript.trim()) {
      return NextResponse.json(
        {
          error: "I didn't catch that. Could you please try again?",
          transcript: "",
          stt_confidence: 0
        },
        { status: 200 }
      );
    }

    const deps = createSchedulerDeps();
    const output = await processSchedulerMessage(transcript, context, deps, "voice");
    const ttsText = buildTtsText(output.response_text);

    let ttsAudioBase64: string | null = null;
    let ttsContentType = "audio/mpeg";
    try {
      const ttsResult = await synthesizeSpeech(ttsText);
      ttsAudioBase64 = ttsResult.audioBase64;
      ttsContentType = ttsResult.contentType;
    } catch (ttsError) {
      console.warn("[voice-turn] TTS failed, returning text only:", ttsError);
    }

    return NextResponse.json({
      transcript,
      stt_confidence: sttConfidence,
      response_text: output.response_text,
      tts_text: ttsText,
      tts_audio_base64: ttsAudioBase64,
      tts_content_type: ttsContentType,
      next_state: output.next_state,
      context: output.context,
      booking_code: output.booking_code,
      slots_offered: output.slots_offered,
      secure_link: output.secure_link,
      my_bookings_redirect: output.my_bookings_redirect,
      pii_warning: output.pii_warning
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[voice-turn] Unexpected error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
