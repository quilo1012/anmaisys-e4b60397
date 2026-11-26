import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AnnouncementInput, AudienceOptions, ManagedAnnouncement, MyAnnouncement, ReportRow } from "@/lib/announcements";

// The functions are BLOCO 164; the generated types learn them when it is pasted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** PostgREST's "no such function" — BLOCO 164 has not been pasted yet. */
export function isNotInstalled(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "PGRST202" || code === "PGRST205" || code === "42P01" || code === "42883";
}

const emptyWhenNotInstalled = <T,>(empty: T, error: { code?: string } | null, data: T | null): T => {
  if (error && isNotInstalled(error)) return empty;
  if (error) throw error;
  return data ?? empty;
};

/** The announcements addressed to me, newest first. None before BLOCO 164. */
export function useMyAnnouncements() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["announcements_mine", user?.id],
    enabled: !!user,
    refetchOnWindowFocus: true,
    refetchInterval: 120_000,
    queryFn: async (): Promise<MyAnnouncement[]> => {
      const { data, error } = await db.rpc("my_announcements", { p_limit: 100 });
      return emptyWhenNotInstalled<MyAnnouncement[]>([], error, data);
    },
  });
}

/** "I HAVE READ THIS ANNOUNCEMENT". The database keeps the first time; a second press changes nothing. */
export function useAcknowledgeAnnouncement() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("read_announcement", { p_id: id, p_acknowledge: true });
      if (error) throw error;
    },
    onMutate: async (id: string) => {
      const key = ["announcements_mine", user?.id];
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<MyAnnouncement[]>(key);
      const now = new Date().toISOString();
      qc.setQueryData<MyAnnouncement[]>(key, (list) =>
        list?.map((a) => (a.id === id ? { ...a, read_at: a.read_at ?? now, acknowledged_at: a.acknowledged_at ?? now } : a)));
      return { before, key };
    },
    onError: (_e, _id, ctx) => { if (ctx) qc.setQueryData(ctx.key, ctx.before); },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["announcements_mine"] });
      qc.invalidateQueries({ queryKey: ["my_notifications"] });
    },
  });
}

/** What I may manage: my own, or all for an admin. */
export function useManagedAnnouncements(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["announcements_managed", user?.id],
    enabled: !!user && enabled,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ManagedAnnouncement[]> => {
      const { data, error } = await db.rpc("announcements_manage_list");
      return emptyWhenNotInstalled<ManagedAnnouncement[]>([], error, data);
    },
  });
}

/** The departments and shifts employees actually carry — the form's only choices. */
export function useAudienceOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["announcement_audience_options"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AudienceOptions> => {
      const { data, error } = await db.rpc("announcement_audience_options");
      const rows = emptyWhenNotInstalled<{ kind: string; value: string }[]>([], error, data);
      return {
        departments: rows.filter((r) => r.kind === "department").map((r) => r.value),
        shifts: rows.filter((r) => r.kind === "shift_group").map((r) => r.value),
      };
    },
  });
}

/** How many will receive it, and how many targeted employees have no login. */
export function useAudiencePreview(department: string | null, shift: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["announcement_audience_preview", department, shift],
    enabled,
    queryFn: async (): Promise<{ with_login: number; without_login: number } | null> => {
      const { data, error } = await db.rpc("announcement_audience_preview", { p_department: department, p_shift_group: shift });
      const rows = emptyWhenNotInstalled<{ with_login: number; without_login: number }[]>([], error, data);
      return rows[0] ?? null;
    },
  });
}

export function useReadReport(id: string | null) {
  return useQuery({
    queryKey: ["announcement_read_report", id],
    enabled: !!id,
    refetchInterval: 60_000,
    queryFn: async (): Promise<ReportRow[]> => {
      const { data, error } = await db.rpc("announcement_read_report", { p_id: id });
      if (error) throw error;
      return (data ?? []) as ReportRow[];
    },
  });
}

export function useAnnouncementActions() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["announcements_managed"] });
    qc.invalidateQueries({ queryKey: ["announcements_mine"] });
    qc.invalidateQueries({ queryKey: ["announcement_read_report"] });
  };
  const publish = useMutation({
    mutationFn: async (i: AnnouncementInput): Promise<string> => {
      const { data, error } = await db.rpc("publish_announcement", {
        p_title: i.title, p_body: i.body, p_category: "company",
        p_department: i.department, p_shift_group: i.shiftGroup,
        p_requires_ack: true, p_urgent: i.urgent,
        p_expires_at: i.expiresAt, p_image_path: null, p_publish_at: i.publishAt,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: async ({ id, input: i }: { id: string; input: AnnouncementInput }) => {
      const { error } = await db.rpc("update_announcement", {
        p_id: id, p_title: i.title, p_body: i.body,
        p_department: i.department, p_shift_group: i.shiftGroup,
        p_requires_ack: true, p_urgent: i.urgent,
        p_expires_at: i.expiresAt, p_publish_at: i.publishAt,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const withdraw = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("withdraw_announcement", { p_id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("delete_announcement", { p_id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  return { publish, update, withdraw, remove };
}
