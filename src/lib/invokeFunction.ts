import { supabase } from "@/integrations/supabase/client";

async function normalizeFunctionError(error: any) {
  if (!error?.context) return error;

  try {
    const payload = await error.context.json();
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.message === "string"
          ? payload.message
          : error.message;

    return {
      ...error,
      message,
      details: payload,
    };
  } catch {
    try {
      const text = await error.context.text();
      const parsed = JSON.parse(text);
      const message =
        typeof parsed?.error === "string"
          ? parsed.error
          : typeof parsed?.message === "string"
            ? parsed.message
            : text || error.message;

      return {
        ...error,
        message,
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
