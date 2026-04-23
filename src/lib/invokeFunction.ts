import { supabase } from "@/integrations/supabase/client";

/**
 * Calls a Supabase Edge Function via the official SDK.
 * Proactively refreshes the session when it's about to expire to avoid stale-JWT errors.
 *
 * Why use the SDK instead of a manual `fetch`?
 *   - The SDK uses headers that don't trigger a CORS preflight.
 *   - The custom fetch wrapper installed by `installDeviceFetch()` adds
 *     `x-device-token`, which DOES trigger a preflight and is rejected by
 *     the Edge Functions gateway. The SDK avoids that path.
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

  return await supabase.functions.invoke<T>(name, {
    body: body ?? {},
  });
}
