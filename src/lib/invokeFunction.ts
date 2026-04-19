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
    // ignore — invoke will surface the real error
  }
  return await supabase.functions.invoke<T>(name, {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}
