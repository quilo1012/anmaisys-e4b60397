import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * When an edge function refuses, the person is shown the sentence, not the tag.
 *
 * These functions answer with both: a short machine tag in `error` for code to branch
 * on, and — when there is something useful to say — a sentence in `message`:
 *
 *     { error: "unreachable",
 *       message: "Could not reach the SharePoint RAG service at https://… —
 *                 update it in Settings." }
 *
 * invokeFunction took `error` first, so the toast on the RAG settings screen said
 * "unreachable" while the sentence naming the dead address, and the screen to fix it
 * on, sat unread in the same response. On 07/09 that screen was the one being used to
 * chase precisely that address.
 *
 * The 200-carrying-a-refusal path in RAGWeeklyPage has always read them the other way
 * round (`data.message || data.error`); this is the non-2xx path brought in line.
 */

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      refreshSession: async () => ({}),
    },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

const { invokeFunction } = await import("@/lib/invokeFunction");

/** The shape supabase-js hands back for a non-2xx: a FunctionsHttpError with the response. */
function httpError(body: unknown, status = 502) {
  return {
    error: Object.assign(new Error(`Edge Function returned a non-2xx status code`), {
      context: new Response(JSON.stringify(body), { status }),
    }),
    data: null,
  };
}

beforeEach(() => invoke.mockReset());

describe("an edge function refusal", () => {
  it("surfaces the sentence when the body carries both a tag and a message", async () => {
    invoke.mockResolvedValue(
      httpError({
        error: "unreachable",
        message: "Could not reach the SharePoint RAG service at https://x.trycloudflare.com. The address may have changed — update it in Settings.",
      }),
    );

    const { error } = await invokeFunction("rag-sharepoint-sync", { mode: "health" });

    expect(error.message).toContain("update it in Settings");
    // The tag is still there for code that branches on it.
    expect(error.details.error).toBe("unreachable");
  });

  it("falls back to the tag when that is all the function sent", async () => {
    invoke.mockResolvedValue(httpError({ error: "forbidden" }, 403));

    const { error } = await invokeFunction("rag-sharepoint-sync", { mode: "week" });

    expect(error.message).toBe("forbidden");
  });

  it("keeps the SDK's own message when the body says nothing useful", async () => {
    invoke.mockResolvedValue(httpError({ error: "   " }, 500));

    const { error } = await invokeFunction("rag-sharepoint-sync", {});

    expect(error.message).toContain("non-2xx");
  });
});
