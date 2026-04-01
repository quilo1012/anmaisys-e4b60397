import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ChecklistItem {
  id: string;
  problem_description_id: string;
  type: string;
  description: string;
  is_required: boolean;
  created_at: string;
}

export interface ChecklistResponse {
  id: string;
  work_order_id: string;
  checklist_id: string;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
}

export function useChecklistsByProblem(problemDescriptionId: string | undefined) {
  return useQuery({
    queryKey: ["checklists", problemDescriptionId],
    queryFn: async () => {
      if (!problemDescriptionId) return [];
      const { data, error } = await (supabase as any)
        .from("checklists")
        .select("*")
        .eq("problem_description_id", problemDescriptionId)
        .order("type")
        .order("description");
      if (error) throw error;
      return data as ChecklistItem[];
    },
    enabled: !!problemDescriptionId,
  });
}

export function useChecklistsByProblemName(problemName: string | undefined) {
  return useQuery({
    queryKey: ["checklists_by_name", problemName],
    queryFn: async () => {
      if (!problemName) return [];
      // First find the problem_description by name
      const { data: problems } = await (supabase as any)
        .from("problem_descriptions")
        .select("id")
        .eq("name", problemName)
        .eq("active", true)
        .limit(1);
      if (!problems?.length) return [];
      const { data, error } = await (supabase as any)
        .from("checklists")
        .select("*")
        .eq("problem_description_id", problems[0].id)
        .order("type")
        .order("description");
      if (error) throw error;
      return data as ChecklistItem[];
    },
    enabled: !!problemName,
  });
}

export function useChecklistResponses(workOrderId: string | undefined) {
  return useQuery({
    queryKey: ["checklist_responses", workOrderId],
    queryFn: async () => {
      if (!workOrderId) return [];
      const { data, error } = await (supabase as any)
        .from("checklist_responses")
        .select("*")
        .eq("work_order_id", workOrderId);
      if (error) throw error;
      return data as ChecklistResponse[];
    },
    enabled: !!workOrderId,
  });
}

export function useSaveChecklistResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workOrderId, checklistId, completed, completedBy }: {
      workOrderId: string;
      checklistId: string;
      completed: boolean;
      completedBy?: string;
    }) => {
      const { error } = await (supabase as any)
        .from("checklist_responses")
        .upsert({
          work_order_id: workOrderId,
          checklist_id: checklistId,
          completed,
          completed_by: completedBy || null,
          completed_at: completed ? new Date().toISOString() : null,
        }, { onConflict: "work_order_id,checklist_id" });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["checklist_responses", vars.workOrderId] });
    },
  });
}

// Admin CRUD for checklist items
export function useAddChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: { problem_description_id: string; type: string; description: string; is_required: boolean }) => {
      const { data, error } = await (supabase as any)
        .from("checklists")
        .insert(item)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["checklists", vars.problem_description_id] });
    },
  });
}

export function useDeleteChecklist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("checklists")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
  });
}
