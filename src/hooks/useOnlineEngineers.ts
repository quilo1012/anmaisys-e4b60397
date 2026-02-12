import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OnlineEngineer {
  id: string;
  name: string;
  last_seen_at: string;
}

export function useOnlineEngineers() {
  return useQuery({
    queryKey: ["online_engineers"],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("id, name, last_seen_at")
        .gt("last_seen_at", cutoff);
      if (error) throw error;

      // Filter to only engineers by checking user_roles
      const ids = (data as any[]).map((p: any) => p.id);
      if (!ids.length) return [] as OnlineEngineer[];

      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "engineer")
        .in("user_id", ids);
      if (rolesErr) throw rolesErr;

      const engineerIds = new Set(roles.map((r) => r.user_id));
      return (data as any[]).filter((p: any) => engineerIds.has(p.id)) as OnlineEngineer[];
    },
    refetchInterval: 15_000,
  });
}
