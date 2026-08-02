import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/invokeFunction";

export interface OperatorLineAccount {
  id: string;
  user_id: string;
  email: string;
  label: string;
  line_ids: string[];
  created_at: string;
  favicon_url?: string | null;
}

/** Public, anon-safe tablet listing — NO email, NO user_id. Used on the Login screen. */
export interface PublicTabletAccount {
  id: string;
  label: string;
  line_ids: string[];
  favicon_url?: string | null;
}

export function usePublicTabletAccounts() {
  return useQuery({
    queryKey: ["public_tablet_accounts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_tablet_accounts_public");
      if (error) throw error;
      return (data ?? []) as PublicTabletAccount[];
    },
    // Login screen must reflect newly uploaded per-tablet favicons on the
    // very next visit — no stale cache, always refetch on mount.
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useOperatorAccounts() {
  const { user } = useAuth();
  return useQuery({
    // Keyed by user, and not run at all until there is one.
    //
    // `operator_line_accounts` is RLS-protected, and RLS answers a request with no
    // session by returning zero rows rather than an error. Run on mount — which is
    // what happens when a login redirects straight here — the query cached an empty
    // list for two minutes, so the operator's line could never resolve and the page
    // sat on its spinner. Reloading worked because the session was already in
    // storage by then.
    queryKey: ["operator_line_accounts", user?.id ?? null],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_line_accounts")
        .select("id, user_id, email, label, line_ids, created_at, favicon_url")
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OperatorLineAccount[];
    },
    staleTime: 2 * 60_000,
  });
}

export function useCreateOperatorAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string; label: string; line_ids: string[] }) => {
      const { data, error } = await invokeFunction("create-operator-account", input);
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operator_line_accounts"] }),
  });
}

export function useUpdateOperatorAccountLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; label: string; line_ids: string[] }) => {
      const { error } = await (supabase as any)
        .from("operator_line_accounts")
        .update({ label: input.label, line_ids: input.line_ids })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operator_line_accounts"] }),
  });
}

export function useUpdateOperatorAccountEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; email: string }) => {
      const { data, error } = await invokeFunction("update-operator-email", input);
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { success: true; email: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operator_line_accounts"] }),
  });
}

export function useUpdateOperatorAccountFavicon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; favicon_url: string | null }) => {
      const { error } = await (supabase as any)
        .from("operator_line_accounts")
        .update({ favicon_url: input.favicon_url })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["operator_line_accounts"] });
      qc.invalidateQueries({ queryKey: ["public_tablet_accounts"] });
    },
  });
}

export function useResetOperatorPassword() {
  return useMutation({
    mutationFn: async (input: { password: string; user_id?: string }) => {
      const { data, error } = await invokeFunction("reset-operator-password", input);
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { success: true; updated: number; total: number };
    },
  });
}
