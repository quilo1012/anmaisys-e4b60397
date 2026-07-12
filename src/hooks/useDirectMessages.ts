import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Play a short two-tone chime for incoming DMs. */
function playDMNotification() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.18, now + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.18);
      o.stop(now + i * 0.18 + 0.24);
    });
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {}
}

export interface DMPartner {
  user_id: string;
  name: string;
  email: string | null;
  line_labels?: string | null;
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  recipient_id: string;
  message: string;
  image_url: string | null;
  read_at: string | null;
  created_at: string;
}

/** Admin → list operator conversation partners. Operator → list admin partners. */
export function useDMPartners(role: string | null | undefined) {
  return useQuery({
    queryKey: ["dm_partners", role],
    queryFn: async () => {
      const rpc = role === "admin" || role === "supervisor" ? "list_dm_operators" : "list_dm_admins";
      const { data, error } = await supabase.rpc(rpc as any);
      if (error) throw error;
      return (data ?? []) as DMPartner[];
    },
    enabled: !!role,
  });
}

export function useDMThread(partnerId: string | null) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["dm_thread", user?.id, partnerId],
    queryFn: async () => {
      if (!user || !partnerId) return [];
      const { data, error } = await supabase
        .from("direct_messages" as any)
        .select("*")
        .or(
          `and(sender_id.eq.${user.id},recipient_id.eq.${partnerId}),` +
            `and(sender_id.eq.${partnerId},recipient_id.eq.${user.id})`,
        )
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as DirectMessage[];
    },
    enabled: !!user && !!partnerId,
  });

  useEffect(() => {
    if (!user || !partnerId) return;
    const channel = supabase
      .channel(`dm_${user.id}_${partnerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "direct_messages" },
        (payload) => {
          const row = (payload.new || payload.old) as DirectMessage;
          if (!row) return;
          const involves =
            (row.sender_id === user.id && row.recipient_id === partnerId) ||
            (row.sender_id === partnerId && row.recipient_id === user.id);
          if (involves) {
            queryClient.invalidateQueries({ queryKey: ["dm_thread", user.id, partnerId] });
            queryClient.invalidateQueries({ queryKey: ["dm_unread", user.id] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, partnerId, queryClient]);

  return query;
}

export function useSendDM() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  return useMutation({
    mutationFn: async ({
      recipientId,
      message,
      imageUrl,
    }: {
      recipientId: string;
      message: string;
      imageUrl?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("direct_messages" as any).insert({
        sender_id: user.id,
        sender_name: profile?.name || user.email || "Unknown",
        recipient_id: recipientId,
        message,
        image_url: imageUrl ?? null,
      } as any);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries({ queryKey: ["dm_thread", user?.id, vars.recipientId] });
    },
  });
}

export function useMarkDMRead(partnerId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!user || !partnerId) return;
      await supabase
        .from("direct_messages" as any)
        .update({ read_at: new Date().toISOString() } as any)
        .eq("recipient_id", user.id)
        .eq("sender_id", partnerId)
        .is("read_at", null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dm_unread", user?.id] });
    },
  });
}

/** Total unread messages for current user. */
export function useDMUnreadCount() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["dm_unread", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from("direct_messages" as any)
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", user.id)
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`dm_unread_${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dm_unread", user.id] });
          queryClient.invalidateQueries({ queryKey: ["dm_thread"] });
          playDMNotification();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${user.id}` },
        () => queryClient.invalidateQueries({ queryKey: ["dm_unread", user.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  return query;
}
