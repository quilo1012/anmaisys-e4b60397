import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OperatorLineAccount {
  id: string;
  user_id: string;
  email: string;
  label: string;
  line_ids: string[];
  created_at: string;
}

export function useOperatorAccounts() {
  return useQuery({
    queryKey: ["operator_line_accounts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("operator_line_accounts")
        .select("id, user_id, email, label, line_ids, created_at")
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OperatorLineAccount[];
    },
  });
}

export function useCreateOperatorAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string; label: string; line_ids: string[] }) => {
      const { data, error } = await supabase.functions.invoke("create-operator-account", { body: input });
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

export function useResetOperatorPassword() {
  return useMutation({
    mutationFn: async (input: { password: string; user_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("reset-operator-password", { body: input });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { success: true; updated: number; total: number };
    },
  });
}
