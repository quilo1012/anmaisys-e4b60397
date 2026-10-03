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
  /**
   * The names of the lines this post writes to.
   *
   * The list used to show the label and nothing else, and the label is free text an
   * admin types: "Capsules Line" points at Tablet Line, and nobody standing at the
   * tablet could have known. It also made two posts sharing a label impossible to
   * tell apart. `lines` is not readable before sign-in, so the name comes from
   * `list_tablet_accounts_public()` itself.
   */
  line_names: string[];
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
    // Paint from cache, revalidate behind it.
    //
    // This was `staleTime: 0` + `refetchOnMount: "always"` so a newly uploaded
    // per-tablet favicon showed on the very next visit. The cost was paid by the
    // wrong person: the operator opening the app on factory wifi waited for a round
    // trip before the list of posts existed at all. The posts change a few times a
    // year; an icon that appears 200ms late costs nobody anything.
    staleTime: 5 * 60_000,
    refetchOnMount: true,
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
    /**
     * Ou `user_id` (um posto), ou `all: true` (todos). A função recusa se vierem
     * os dois, e recusa se não vier nenhum — antes, não vir nenhum significava
     * silenciosamente "repõe todos", e um campo perdido numa refactorização tirava
     * o acesso à fábrica inteira.
     */
    mutationFn: async (
      input:
        | { password: string; user_id: string }
        | { password: string; all: true },
    ) => {
      const { data, error } = await invokeFunction("reset-operator-password", input);
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { success: true; updated: number; total: number };
    },
  });
}
