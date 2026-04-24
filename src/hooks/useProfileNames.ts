import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProfileName {
  id: string;
  name: string;
}

/**
 * Lista nomes de utilizadores ativos (id + name) acessível a qualquer
 * utilizador autenticado via RPC SECURITY DEFINER.
 * Usado para popular dropdowns como "Requested By".
 */
export function useProfileNames() {
  return useQuery({
    queryKey: ["profile-names-active"],
    queryFn: async (): Promise<ProfileName[]> => {
      const { data, error } = await supabase.rpc("list_active_profile_names");
      if (error) throw error;
      return (data ?? []).filter((p): p is ProfileName => !!p.id && !!p.name);
    },
    staleTime: 60_000,
  });
}
