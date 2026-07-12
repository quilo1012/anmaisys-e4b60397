import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LoginMode = "staff" | "tablet";

export interface LoginBrandingRow {
  mode: LoginMode;
  url: string;
  updated_at: string;
}

export function useLoginBranding() {
  return useQuery({
    queryKey: ["login-branding"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("login_branding")
        .select("mode,url,updated_at");
      if (error) throw error;
      const map: Partial<Record<LoginMode, LoginBrandingRow>> = {};
      (data ?? []).forEach((r) => {
        map[r.mode as LoginMode] = r as LoginBrandingRow;
      });
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveLoginBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mode, url }: { mode: LoginMode; url: string }) => {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("login_branding")
        .upsert({ mode, url, updated_by: user.user?.id ?? null, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["login-branding"] }),
  });
}

export function useDeleteLoginBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mode: LoginMode) => {
      const { error } = await supabase.from("login_branding").delete().eq("mode", mode);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["login-branding"] }),
  });
}
