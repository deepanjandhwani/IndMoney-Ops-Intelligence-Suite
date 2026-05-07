import { NextRequest, NextResponse } from "next/server";

import { getSchedulerGreeting, processSchedulerMessage } from "@/services/scheduler/state-machine";
import { createSchedulerDeps } from "@/services/scheduler/server";
import { InputMode, SchedulerSessionContext } from "@/services/scheduler/types";
import { createSupabaseServerClient } from "@/adapters/supabase/server-client";
import { synthesizeSpeech } from "@/adapters/deepgram/index";
import { buildTtsText } from "@/services/scheduler/voice-format";

export const dynamic = "force-dynamic";

async function getCustomerId(): Promise<string | undefined> {
  try {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id;
  } catch {
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  try {
    const inputMode = parseInputMode(request.nextUrl.searchParams.get("mode"));
    const deps = createSchedulerDeps();
    const output = await getSchedulerGreeting(deps.repository, inputMode);

    let tts_audio_base64: string | null = null;
    let tts_content_type = "audio/mpeg";
    const tts_text = buildTtsText(output.response_text);
    try {
      const ttsResult = await synthesizeSpeech(tts_text);
      tts_audio_base64 = ttsResult.audioBase64;
      tts_content_type = ttsResult.contentType;
    } catch {
      /* TTS is best-effort; greeting still works without audio */
    }

    return NextResponse.json({
      ...output,
      tts_text,
      tts_audio_base64,
      tts_content_type
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      text?: string;
      input_mode?: InputMode;
      context?: SchedulerSessionContext;
    };
    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "Message text is required." }, { status: 400 });
    }

    const customerId = await getCustomerId();
    const context = body.context
      ? { ...body.context, customer_id: customerId }
      : undefined;

    const deps = createSchedulerDeps();
    const output = await processSchedulerMessage(
      text,
      context,
      deps,
      parseInputMode(body.input_mode)
    );
    return NextResponse.json(output);
  } catch (error) {
    return errorResponse(error);
  }
}

function parseInputMode(input?: string | null): InputMode {
  return input === "voice" ? "voice" : "chat";
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: 500 });
}
