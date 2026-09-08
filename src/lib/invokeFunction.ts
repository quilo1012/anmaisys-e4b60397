import { supabase } from "@/integrations/supabase/client";

/**
 * Picks the line a person should be shown out of an edge function's error body.
 *
 * The functions in this project answer with a machine tag and, when there is
 * something useful to say, a sentence beside it:
 *
 *     { "error": "unreachable",
 *       "message": "Could not reach the SharePoint RAG service at https://… —
 *                   update it in Settings." }
 *
 * This used to take `error` first, so a toast that could have named the address and
 * the screen to fix it read "unreachable" instead. The rest of the codebase already
 * reads them the other way round — `data.message || data.error`, in RAGWeeklyPage and
 * everywhere else that handles a 200 carrying a refusal — and this brings the non-2xx
 * path in line with it. The tag is still what code branches on; it is in `details`,
 * untouched.
 */
function humanMessage(payload: any, fallback: string): string {
  if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
  if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
  return fallback;
}

async function normalizeFunctionError(error: any) {
  if (!error?.context) return error;

  try {
    const payload = await error.context.json();
    return {
      ...error,
      message: humanMessage(payload, error.message),
      details: payload,
    };
  } catch {
    try {
      const text = await error.context.text();
      const parsed = JSON.parse(text);
      return {
        ...error,
        message: humanMessage(parsed, text || error.message),
        details: parsed,
      };
    } catch {
      return error;
    }
  }
}

/**
 * Calls a Supabase Edge Function via the official SDK.
 * Proactively refreshes the session when it's about to expire to avoid stale-JWT errors.
 */
export async function invokeFunction<T = any>(
  name: string,
  body?: unknown,
): Promise<{ data: T | null; error: any }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.expires_at) {
      const remaining = session.expires_at - Math.floor(Date.now() / 1000);
      if (remaining < 60) {
        await supabase.auth.refreshSession();
      }
    }
  } catch {
    // ignore — invoke below will surface real errors
  }

  const result = await supabase.functions.invoke<T>(name, {
    body: body ?? {},
  });

  if (result.error) {
    return {
      data: result.data,
      error: await normalizeFunctionError(result.error),
    };
  }

  return result;
}
