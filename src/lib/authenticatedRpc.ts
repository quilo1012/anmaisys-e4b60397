import { supabase } from "@/integrations/supabase/client";
import { NoLiveSessionError } from "@/lib/liveSession";
import type { Database } from "@/integrations/supabase/types";

type Functions = Database["public"]["Functions"];

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
  return supabase.rpc(name, args).setHeader("Authorization", `Bearer ${session.access_token}`);
}