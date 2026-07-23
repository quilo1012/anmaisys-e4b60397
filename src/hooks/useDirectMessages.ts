import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { showDMToast, dmNativeTitle, dmNativeBody } from "@/components/DMNotificationToast";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrentShiftStart, getCurrentFactoryShift } from "@/lib/shifts";

let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return null;
    if (!sharedAudioCtx) sharedAudioCtx = new Ctx();
    return sharedAudioCtx;
  } catch { return null; }
}

/** Call on a user gesture to unlock audio (autoplay policy). Safe/no-op otherwise. */
export function unlockDMAudio() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  try {
    // iOS/Safari unlock: play one silent sample.
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {}
}

/** MSN-Messenger-style short 3-note alert. */
function playDMNotification() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const master = ctx.createGain();
    master.gain.value = 0.15;
    master.connect(ctx.destination);
    const start0 = ctx.currentTime + 0.02;
    const notes = [660, 880, 1174];
    notes.forEach((freq, i) => {
      const start = start0 + i * 0.11;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(1, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
      o.connect(g).connect(master);
      o.start(start);
      o.stop(start + 0.1);
    });
    try { navigator.vibrate?.([80, 40, 80]); } catch {}
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

/**
 * Conversation partners, scoped by role in the backend (list_dm_partners):
 *   operator   → supervisors only
 *   supervisor → operators + management (the bridge)
 *   management → management + supervisors (never operators)
 */
export function useDMPartners(role: string | null | undefined) {
  return useQuery({
    queryKey: ["dm_partners", role],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_dm_partners" as any);
      if (error) throw error;
      return (data ?? []) as DMPartner[];
    },
    enabled: !!role,
  });
}

export function useDMThread(partnerId: string | null) {
  const queryClient = useQueryClient();
  const { user, role } = useAuth();
  const isOperator = role === "operator";
  const shiftInfo = getCurrentFactoryShift();
  const shiftToken = isOperator ? `${shiftInfo.sessionDate}-${shiftInfo.shiftCode}` : "all";

  const query = useQuery({
    queryKey: ["dm_thread", user?.id, partnerId, shiftToken],
    queryFn: async () => {
      if (!user || !partnerId) return [];
      let q = supabase
        .from("direct_messages" as any)
        .select("*")
        .or(
          `and(sender_id.eq.${user.id},recipient_id.eq.${partnerId}),` +
            `and(sender_id.eq.${partnerId},recipient_id.eq.${user.id})`,
        )
        .order("created_at", { ascending: true });
      if (isOperator) {
        q = q.gte("created_at", getCurrentShiftStart().toISOString());
      }
      const { data, error } = await q;
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
      queryClient.invalidateQueries({ queryKey: ["dm_unread_by_sender", user?.id] });
    },
  });
}

/** Unread message counts grouped by sender (partner user_id) for the current user. */
export function useDMUnreadBySender() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["dm_unread_by_sender", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return {} as Record<string, number>;
      const { data, error } = await supabase
        .from("direct_messages" as any)
        .select("sender_id")
        .eq("recipient_id", user.id)
        .is("read_at", null);
      if (error) throw error;
      const map: Record<string, number> = {};
      (data ?? []).forEach((r: any) => {
        if (r?.sender_id) map[r.sender_id] = (map[r.sender_id] ?? 0) + 1;
      });
      return map;
    },
  });
}

/** Total unread messages for current user. */
export function useDMUnreadCount() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ["dm_unread", user.id] });
          queryClient.invalidateQueries({ queryKey: ["dm_unread_by_sender", user.id] });
          queryClient.invalidateQueries({ queryKey: ["dm_thread"] });
          playDMNotification();

          const row = (payload.new || {}) as Partial<DirectMessage>;
          const senderName = row.sender_name || "New message";

          const onMessagesPage =
            typeof window !== "undefined" &&
            window.location.pathname === "/dashboard/messages";

          // Discreet, MSN-style: announce a new message with the logo, but never
          // the message content — the user opens the chat to read it.
          if (!onMessagesPage) {
            showDMToast({
              senderName,
              onOpen: () => navigate("/dashboard/messages"),
            });
          }

          if (
            typeof document !== "undefined" &&
            document.visibilityState === "hidden" &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            try {
              new Notification(dmNativeTitle(senderName), {
                body: dmNativeBody(),
                icon: "/appliedlogo.jpeg",
                tag: `dm-${row.sender_id ?? ""}`,
              });
            } catch {}
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dm_unread", user.id] });
          queryClient.invalidateQueries({ queryKey: ["dm_unread_by_sender", user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient, navigate]);

  return query;
}
