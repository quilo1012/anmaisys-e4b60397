import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export interface WOMessage {
  id: string;
  work_order_id: string;
  user_id: string;
  user_name: string;
  message: string;
  image_url: string | null;
  created_at: string;
}

export function useWOMessages(workOrderId: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["wo_messages", workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wo_messages")
        .select("*")
        .eq("work_order_id", workOrderId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as WOMessage[];
    },
    enabled: !!workOrderId,
  });

  useEffect(() => {
    if (!workOrderId) return;
    const channel = supabase
      .channel(`wo_messages_${workOrderId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "wo_messages",
        filter: `work_order_id=eq.${workOrderId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ["wo_messages", workOrderId] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [workOrderId, queryClient]);

  return query;
}

export function useSendWOMessage() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async ({ workOrderId, message, imageUrl }: { workOrderId: string; message: string; imageUrl?: string }) => {
      const { error } = await supabase.from("wo_messages").insert({
        work_order_id: workOrderId,
        user_id: user!.id,
        user_name: profile?.name || user!.email || "Unknown",
        message,
        image_url: imageUrl || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wo_messages", vars.workOrderId] });
    },
  });
}
