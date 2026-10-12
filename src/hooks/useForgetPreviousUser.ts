import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * The query cache belongs to one person. When the signed-in person changes, it goes.
 *
 * Query keys here are not per user — `["overtime_responses"]`, `["my_overtime_block"]`
 * — and signing out reset the session but never the cache. On a shared tablet the badge
 * sign-in hands the screen from one person to the next inside the same page, so the
 * second person's first frame was drawn from the first person's answers until the
 * refetch landed.
 *
 * Keyed on the user id, not on auth events: a token refresh keeps the id and keeps the
 * cache; a sign-out (id → null) or a different person (id → other id) clears it. The
 * first sign-in of a fresh page has nothing to forget and clears nothing.
 */
export function useForgetPreviousUser(userId: string | null | undefined): void {
  const queryClient = useQueryClient();
  const last = useRef<string | null>(null);

  useEffect(() => {
    const now = userId ?? null;
    if (last.current !== null && now !== last.current) queryClient.clear();
    if (now !== null || last.current !== null) last.current = now;
  }, [userId, queryClient]);
}
