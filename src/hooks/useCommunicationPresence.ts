import { useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  PRESENCE_MAX_IDS, PRESENCE_REFRESH_MS, chunk, myDisplayedAvailability, parseAvailability, stableIds,
  type AvailabilityStatus,
} from "@/lib/communicationPresence";

/**
 * The client side of Communication availability. The rules live in the database
 * (20261021090000) and in `src/lib/communicationPresence.ts`; this file only asks.
 *
 *  - Your CHOICE is written by `communication_set_availability`, which takes no user id:
 *    it writes the caller's own row, and nothing else can.
 *  - Everyone else's STATUS is read from `communication_presence_for`, which answers for
 *    the people the Hub lists for you and no one else, with the server's clock.
 *  - Nothing here is ever checked before a message is sent. Availability is shown, not
 *    enforced: a Busy, Away, Do Not Disturb, Offline or On Holiday person is written to
 *    exactly like anyone else.
 */
export const PRESENCE_KEY = "communication_presence";
export const MY_AVAILABILITY_KEY = "communication_my_availability";

export interface MyAvailability {
  /** What you chose. Kept until you change it. */
  preference: AvailabilityStatus;
  /** Approved holiday leave today: shown to others as On Holiday while it lasts. */
  approvedHoliday: boolean;
}

/** Your own choice, and whether approved leave is currently overriding what others see. */
export function useMyAvailability() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [MY_AVAILABILITY_KEY, user?.id ?? null],
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<MyAvailability> => {
      const { data, error } = await supabase.rpc("communication_my_availability");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : null;
      return {
        preference: parseAvailability(row?.preference) ?? "online",
        approvedHoliday: row?.approved_holiday === true,
      };
    },
  });
}

/** What your own picker should read: the same word everybody else is shown. */
export function useMyDisplayedAvailability(): AvailabilityStatus | null {
  const { data } = useMyAvailability();
  return data ? myDisplayedAvailability(data.preference, data.approvedHoliday) : null;
}

export function useSetMyAvailability() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = [MY_AVAILABILITY_KEY, user?.id ?? null];
  return useMutation({
    mutationFn: async (preference: AvailabilityStatus) => {
      const { error } = await supabase.rpc("communication_set_availability", { p_preference: preference });
      if (error) throw error;
    },
    // The picker answers at once; the server's answer replaces this when it arrives.
    onMutate: async (preference) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<MyAvailability>(key);
      qc.setQueryData<MyAvailability>(key, (old) => ({ approvedHoliday: old?.approvedHoliday ?? false, preference }));
      return { before };
    },
    onError: (_e, _p, ctx) => { if (ctx?.before) qc.setQueryData(key, ctx.before); },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [MY_AVAILABILITY_KEY] });
      void qc.invalidateQueries({ queryKey: [PRESENCE_KEY] });
    },
  });
}

/**
 * The status of these people, as the server shows them to you. A person missing from the
 * map is one you may not see, or one the server did not answer for: no dot is drawn, and
 * nobody is called Offline on a guess.
 */
export function usePresenceOf(userIds: readonly (string | null | undefined)[]) {
  const { user } = useAuth();
  const ids = useMemo(() => stableIds(userIds), [userIds]);
  const idsKey = ids.join(",");
  const query = useQuery({
    queryKey: [PRESENCE_KEY, idsKey],
    enabled: !!user && ids.length > 0,
    staleTime: 10_000,
    // Connections time out silently; this is what notices. Realtime covers the rest.
    refetchInterval: PRESENCE_REFRESH_MS,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<[string, AvailabilityStatus][]> => {
      const parts = await Promise.all(
        chunk(ids, PRESENCE_MAX_IDS).map(async (part) => {
          const { data, error } = await supabase.rpc("communication_presence_for", { p_user_ids: part });
          if (error) throw error;
          return data ?? [];
        }),
      );
      const out: [string, AvailabilityStatus][] = [];
      for (const row of parts.flat()) {
        const status = parseAvailability(row.status);
        if (status) out.push([row.user_id, status]);
      }
      return out;
    },
  });
  const statuses = useMemo(() => new Map(query.data ?? []), [query.data]);
  return { statuses, isLoading: query.isLoading, isError: query.isError };
}
