import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProblemDescription {
  id: string;
  name: string;
  category: string;
  severity: string;
  description: string;
  active: boolean;
  created_at: string;
}

export function useProblemDescriptions() {
  return useQuery({
    queryKey: ["problem_descriptions"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("problem_descriptions")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as ProblemDescription[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useActiveProblemDescriptions() {
  return useQuery({
    queryKey: ["problem_descriptions", "active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("problem_descriptions")
        .select("*")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as ProblemDescription[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAddProblemDescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (problem: { name: string; category?: string; severity?: string; description?: string; active?: boolean }) => {
      const { error } = await (supabase as any).from("problem_descriptions").insert(problem);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["problem_descriptions"] }),
  });
}

export function useUpdateProblemDescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; category?: string; severity?: string; description?: string; active?: boolean }) => {
      const { error } = await (supabase as any).from("problem_descriptions").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["problem_descriptions"] }),
  });
}

export function useDeleteProblemDescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("problem_descriptions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["problem_descriptions"] }),
  });
}
