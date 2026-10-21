import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PushCoverageRow { phones: number; platforms: string[]; lastRegistered: string | null }

/**
 * Which logins have a phone on the push list, by login id — or null when the answer is
 * not available (BLOCO 123 not pasted yet, or the caller may not manage overtime). Null is
 * "do not draw the column", never "nobody has a phone": a missing answer drawn as a column
 * of "Off" would send a supervisor to chase forty people who may be fine.
 */
export function usePushCoverage(enabled = true) {
  return useQuery({
    queryKey: ["push_coverage"],
    enabled,
    retry: false,
    staleTime: 60_000,
    meta: { schemaOptional: true },
    queryFn: async (): Promise<ReadonlyMap<string, PushCoverageRow> | null> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { data, error } = await (supabase.rpc as any)("push_coverage");
      if (error) return null;
      const rows = (data ?? []) as { user_id: string; phones: number; platforms: string[]; last_registered: string | null }[];
      return new Map(rows.map((r) => [r.user_id, { phones: r.phones, platforms: r.platforms ?? [], lastRegistered: r.last_registered }]));
    },
  });
}
