import { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  AssistantSessionOwnershipError,
  createAssistantHistoryRepository
} from "../src/adapters/supabase/assistant-history-repository";

describe("createAssistantHistoryRepository", () => {
  it("ensureSession reuses row when device hash matches and bumps activity", async () => {
    const updates: unknown[] = [];
    const client = {
      from(table: string) {
        if (table !== "assistant_sessions") {
          throw new Error(`unexpected table ${table}`);
        }
        return {
          select() {
            return {
              eq(_col: string, id: string) {
                return {
                  maybeSingle: async () => ({
                    data: { id, device_id_hash: "hash-a" },
                    error: null
                  })
                };
              }
            };
          },
          insert() {
            throw new Error("should not insert");
          },
          update(patch: unknown) {
            updates.push(patch);
            return {
              eq() {
                return Promise.resolve({ error: null });
              }
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const repository = createAssistantHistoryRepository(client);
    const id = await repository.ensureSession({ deviceIdHash: "hash-a", sessionId: "sess-1" });
    expect(id).toBe("sess-1");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ last_activity_at: expect.any(String) });
  });

  it("ensureSession throws when session belongs to another device", async () => {
    const client = {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { id: "sess-1", device_id_hash: "other-hash" },
                    error: null
                  })
                };
              }
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const repository = createAssistantHistoryRepository(client);
    await expect(
      repository.ensureSession({ deviceIdHash: "hash-a", sessionId: "sess-1" })
    ).rejects.toBeInstanceOf(AssistantSessionOwnershipError);
  });

  it("appendEvent increments seq and updates lane summary", async () => {
    let inserted: Record<string, unknown> | null = null;
    const client = {
      from(table: string) {
        if (table === "assistant_sessions") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        id: "sess-1",
                        device_id_hash: "hash-a",
                        label: null,
                        lane_summary: { assistant: 0, rag: 1, scheduler: 0 }
                      },
                      error: null
                    })
                  };
                }
              };
            },
            update(patch: unknown) {
              return {
                eq() {
                  expect(patch).toMatchObject({
                    lane_summary: { assistant: 1, rag: 1, scheduler: 0 },
                    label: "Hello there"
                  });
                  return Promise.resolve({ error: null });
                }
              };
            }
          };
        }
        if (table === "assistant_session_events") {
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        limit() {
                          return {
                            maybeSingle: async () => ({ data: { seq: 3 }, error: null })
                          };
                        }
                      };
                    }
                  };
                }
              };
            },
            insert(row: Record<string, unknown>) {
              inserted = row;
              return Promise.resolve({ error: null });
            }
          };
        }
        throw new Error(`unexpected ${table}`);
      }
    } as unknown as SupabaseClient;

    const repository = createAssistantHistoryRepository(client);
    const seq = await repository.appendEvent("sess-1", "hash-a", {
      role: "user",
      lane: "assistant",
      kind: "faq_question",
      content: "Hello there",
      pii_masked: false,
      pii_findings: []
    });

    expect(seq).toBe(4);
    expect(inserted).toMatchObject({
      seq: 4,
      role: "user",
      lane: "assistant",
      kind: "faq_question",
      content: "Hello there"
    });
  });

  it("getSessionTranscript returns null on hash mismatch", async () => {
    const client = {
      from(table: string) {
        if (table === "assistant_sessions") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: "sess-1", device_id_hash: "wrong" },
                      error: null
                    })
                  };
                }
              };
            }
          };
        }
        throw new Error("events should not load");
      }
    } as unknown as SupabaseClient;

    const repository = createAssistantHistoryRepository(client);
    await expect(repository.getSessionTranscript("sess-1", "hash-a")).resolves.toBeNull();
  });

  it("deleteSession removes row when hash matches", async () => {
    let deleted = false;
    const client = {
      from(table: string) {
        if (table === "assistant_sessions") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: "sess-1", device_id_hash: "hash-a" },
                      error: null
                    })
                  };
                }
              };
            },
            delete() {
              return {
                eq() {
                  deleted = true;
                  return Promise.resolve({ error: null });
                }
              };
            }
          };
        }
        throw new Error(`unexpected ${table}`);
      }
    } as unknown as SupabaseClient;

    const repository = createAssistantHistoryRepository(client);
    await expect(repository.deleteSession("sess-1", "hash-a")).resolves.toBe(true);
    expect(deleted).toBe(true);
  });
});
