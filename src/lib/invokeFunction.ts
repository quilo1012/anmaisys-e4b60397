import { supabase } from "@/integrations/supabase/client";

/**
 * Wrapper around supabase.functions.invoke that proactively refreshes the
 * session if it's about to expire. Prevents 403 / api_error_forbidden when
 * the JWT is stale.
 */
export async function invokeFunction<T = any>(
  name: string,
  body?: unknown
): Promise<{ data: T | null; error: any }> {
  let token: string | undefined;
  try {
    let { data: { session } } = await supabase.auth.getSession();
    if (session?.expires_at) {
      const expiresInSec = session.expires_at - Math.floor(Date.now() / 1000);
      if (expiresInSec < 60) {
        const { data } = await supabase.auth.refreshSession();
        session = data.session ?? session;
      }
    }
    token = session?.access_token;
  } catch {
    // ignore — request below will surface the real error
  }

  try {
    const headers: Record<string, string> = {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const raw = await response.text();
    const parsed = raw
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        })()
      : null;

    if (!response.ok) {
      return {
        data: null,
        error: {
          message:
            (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
              ? parsed.error
              : `Failed to call ${name} (${response.status})`),
          status: response.status,
          details: parsed,
        },
      };
    }

    return { data: parsed as T, error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : `Failed to call ${name}`,
      },
    };
  }
}
