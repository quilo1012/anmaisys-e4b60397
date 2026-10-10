import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The invite code, for a screen that is allowed to hold it.
 *
 * Deliberately a hook of its own rather than something `SignupQrCard` does for itself:
 * the card is drawn on the public login screen too, and a card that fetched its own
 * code would carry the code wherever it was placed. The code is passed in by the
 * caller, so which screens may have it is a decision somebody makes on purpose, in one
 * readable place, rather than a side effect of rendering a component.
 *
 * The database decides, not this: `signup_invite_for_tablet` returns the code only to a
 * session whose `auth.uid()` belongs to a line account, and only while sign-up is open
 * and the code unexpired. Null everywhere else — including on every screen that calls
 * this before the migration has run, which is why every failure here is a quiet null
 * and not an error. A QR with no code is the behaviour we already have; a red box on
 * the factory floor is not.
 */
export function useTabletInviteCode(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["signup-invite-for-tablet"],
    enabled,
    // It changes when an admin generates a new one, which is rare, and a stale code
    // walks somebody into a refusal — so not cached for long.
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { data, error } = await (supabase.rpc as any)("signup_invite_for_tablet");
      // Not thrown: before the migration this is a 404, and the screen's answer to
      // "no code available" is the same whatever the reason — a QR without one.
      if (error) return null;
      return (data as string | null) ?? null;
    },
  });
  return data ?? null;
}
