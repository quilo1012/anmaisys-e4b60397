import { supabase } from "@/integrations/supabase/client";
import { NoLiveSessionError } from "@/lib/liveSession";
import type { Database } from "@/integrations/supabase/types";

type Functions = Database["public"]["Functions"];

/** This is only a client skip guard; the server still verifies the signed claim. */
function hasSessionId(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return typeof claims?.session_id === "string" && claims.session_id.trim().length > 0;
  } catch {
    return false;
  }
}

/** Keep the verified token on this request: a concurrent sign-out must not downgrade it to anon. */
export async function authenticatedRpc<Name extends keyof Functions>(
  name: Name,
  args?: Functions[Name]["Args"],
) {
  const { data, error } = await supabase.auth.getSession();
  const session = data?.session;
  if (error || !session?.access_token || (session.expires_at && session.expires_at * 1000 <= Date.now())) {
    throw new NoLiveSessionError();
  }
  // Minted verification tokens have no session_id and cannot hold a presence lease.
  // Check the very token pinned below, not an earlier getSession() snapshot.
  const presenceWrite = name === "communication_touch_presence" || name === "communication_end_presence";
  const tabId = args && "p_tab_id" in args ? args.p_tab_id : undefined;
  if (presenceWrite && (!hasSessionId(session.access_token)
    || typeof tabId !== "string" || !tabId.trim())) {
    // PresenceHeartbeat/endMyPresence already treat this local skip silently.
    throw new NoLiveSessionError();
  }
  return supabase.rpc(name, args).setHeader("Authorization", `Bearer ${session.access_token}`);
}