import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FEED_DAYS, type AskState, type StoredNotification } from "@/lib/notificationFeed";

// `kind` and `overtime_request_id` are BLOCO 100; the generated types learn them when
// the block is pasted. Until then the select below asks only for the old columns.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const OLD_COLUMNS = "id,title,body,priority,action_url,wo_id,read_at,created_at";

/**
 * The signed-in person's own bell rows from the last two weeks, newest first.
 *
 * Filtered on `user_id` here as well as by RLS: the policy lets an admin read every
 * row, and an admin's bell is still only theirs.
 */
export function useMyNotifications() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["my_notifications", user?.id];

  const feed = useQuery({
    queryKey: key,
    enabled: !!user,
    meta: { schemaOptional: true },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<StoredNotification[]> => {
      const since = new Date(Date.now() - FEED_DAYS * 86_400_000).toISOString();
      const run = (cols: string) =>
        db.from("notifications").select(cols)
          .eq("user_id", user!.id).gte("created_at", since)
          .order("created_at", { ascending: false }).limit(50);
      let { data, error } = await run(`${OLD_COLUMNS},kind,overtime_request_id`);
      if (error && (error as { code?: string }).code === "42703") {
        ({ data, error } = await run(OLD_COLUMNS));
      }
      if (error) throw error;
      return ((data ?? []) as Partial<StoredNotification>[]).map((r) => ({
        kind: null, overtime_request_id: null, ...r,
      })) as StoredNotification[];
    },
  });

  const askIds = [...new Set((feed.data ?? []).map((n) => n.overtime_request_id).filter(Boolean))] as string[];
  const asks = useQuery({
    queryKey: ["notification_asks", ...askIds.sort()],
    enabled: askIds.length > 0,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Map<string, AskState>> => {
      const { data, error } = await db.from("overtime_requests")
        .select("id,status,on_date,starts_at").in("id", askIds);
      if (error) throw error;
      return new Map(((data ?? []) as AskState[]).map((a) => [a.id, a]));
    },
  });

  // A new row arrives the moment it is written — no waiting for the next poll.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`my_notifications_${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => { void qc.invalidateQueries({ queryKey: ["my_notifications", user.id] }); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  const markRead = useMutation({
    mutationFn: async (ids: string[] | "all") => {
      let q = db.from("notifications").update({ read_at: new Date().toISOString() })
        .eq("user_id", user!.id).is("read_at", null);
      if (ids !== "all") q = q.in("id", ids);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["my_notifications", user?.id] }); },
  });

  return { notifications: feed.data ?? [], loaded: feed.isSuccess, asks: asks.data ?? new Map<string, AskState>(), markRead };
}
