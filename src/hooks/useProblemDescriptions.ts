import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProblemDescription {
  id: string;
  name: string;
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
  });
}

export function useAddProblemDescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await (supabase as any).from("problem_descriptions").insert({ name });
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
