import { NextResponse } from "next/server";

import { tryCreateSupabaseAdminClient } from "@/adapters/supabase/admin-client";
import { createAssistantHistoryRepository } from "@/adapters/supabase/assistant-history-repository";
import { hashAssistantDeviceId } from "@/adapters/supabase/assistant-device-hash";
import { createSqliteChatHistoryRepository } from "@/adapters/sqlite/chat-history";
import { createSupabaseServerClient } from "@/adapters/supabase/server-client";

export function assistantHistoryJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("cache-control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

export function getAssistantHistoryRepository() {
  const client = tryCreateSupabaseAdminClient();
  if (client) {
    return createAssistantHistoryRepository(client);
  }
  return createSqliteChatHistoryRepository();
}

export function hashDeviceIdFromRequest(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  return hashAssistantDeviceId(trimmed);
}

export async function getUserIdFromRequest(): Promise<string | null> {
  try {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}
