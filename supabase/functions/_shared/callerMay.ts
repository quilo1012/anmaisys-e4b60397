import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Asks the database whether the caller may perform `action`, the same way the
 * Permissions page decides it: `public.has_action` reads `role_permission_overrides`
 * and falls back to `baseline` — which must be the MATRIX default for that action in
 * src/lib/permissions.ts, so a role the page shows as allowed is allowed here too.
 *
 * Runs with the caller's own JWT: `has_action` is granted to `authenticated`, and that
 * grant is the one we know is in production. Any error is a no (fail closed).
 */
export async function callerMay(
  authHeader: string,
  callerId: string,
  action: string,
  baseline: string[],
): Promise<boolean> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    },
  );
  const { data, error } = await userClient.rpc("has_action", {
    _uid: callerId,
    _action: action,
    _baseline: baseline,
  });
  if (error) {
    console.error(`[callerMay] has_action(${action}) failed:`, error.message);
    return false;
  }
  return data === true;
}

/** MATRIX defaults (src/lib/permissions.ts) for the engineer PIN identities. */
export const ENGINEERS_MANAGE_BASELINE = ["admin", "manager", "maintenance_manager"];
export const ENGINEERS_VIEW_BASELINE = ["admin", "manager", "maintenance_manager"];
