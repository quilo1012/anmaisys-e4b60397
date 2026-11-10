import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { InvitablePerson, MeetingResponse, MyMeeting, Recurrence, Scope } from "@/lib/meetings";

// The tables and functions are BLOCO 159; the generated types learn them when it is pasted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** PostgREST's "no such function" — BLOCO 159 has not been pasted yet. */
export function isNotInstalled(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "PGRST202" || code === "PGRST205" || code === "42P01" || code === "42883";
}

const notInstalledIsEmpty = <T,>(empty: T) => (e: { code?: string } | null, data: T | null): T => {
  if (e && isNotInstalled(e)) return empty;
  if (e) throw e;
  return data ?? empty;
};

/**
 * The meetings overlapping [from, to) that this person may see, each with their own
 * answer. RLS decides which (my_meetings runs as the caller): an admin sees all,
 * anybody else only the ones they are invited to.
 */
export function useMeetingsInRange(from: string, to: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["meetings", user?.id, from, to],
    enabled: !!user,
    refetchOnWindowFocus: true,
    refetchInterval: 120_000,
    retry: (n, e) => !isNotInstalled(e) && n < 2,
    queryFn: async (): Promise<MyMeeting[]> => {
      const { data, error } = await db.rpc("my_meetings", { p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []) as MyMeeting[];
    },
  });
}

/** The next three this person is in and has not declined; none before BLOCO 159. */
export function useUpcomingMeetings(limit = 3) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["meetings_upcoming", user?.id, limit],
    enabled: !!user,
    refetchInterval: 120_000,
    queryFn: async (): Promise<MyMeeting[]> => {
      const { data, error } = await db.rpc("my_upcoming_meetings", { p_limit: limit });
      return notInstalledIsEmpty<MyMeeting[]>([])(error, data);
    },
  });
}

export function useMeeting(id: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["meeting", id, user?.id],
    enabled: !!user && !!id,
    queryFn: async (): Promise<MyMeeting | null> => {
      const { data, error } = await db.rpc("my_meeting", { p_id: id });
      const rows = notInstalledIsEmpty<MyMeeting[]>([])(error, data);
      return rows[0] ?? null;
    },
  });
}

export interface ParticipantRow { user_id: string; name: string; response: MeetingResponse; responded_at: string | null }

export function useMeetingParticipants(id: string | null) {
  return useQuery({
    queryKey: ["meeting_participants", id],
    enabled: !!id,
    queryFn: async (): Promise<ParticipantRow[]> => {
      const { data, error } = await db.rpc("meeting_participant_list", { p_meeting: id });
      if (error) throw error;
      return (data ?? []) as ParticipantRow[];
    },
  });
}

export function useInvitablePeople(enabled: boolean) {
  return useQuery({
    queryKey: ["meeting_invitable_people"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<InvitablePerson[]> => {
      const { data, error } = await db.rpc("meeting_invitable_people");
      if (error) throw error;
      return (data ?? []) as InvitablePerson[];
    },
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["meetings", "meetings_upcoming", "meeting", "meeting_participants", "my_notifications"]) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };
}

export interface MeetingInput {
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  location: string;
  video_link: string;
  recurrence: Recurrence;
  recurrence_until: string | null;
  participants: string[];
}

export function useMeetingActions() {
  const refresh = useRefresh();
  const create = useMutation({
    mutationFn: async (m: MeetingInput) => {
      const { data, error } = await db.rpc("meeting_create", {
        p_title: m.title, p_description: m.description, p_starts_at: m.starts_at, p_ends_at: m.ends_at,
        p_location: m.location, p_video_link: m.video_link, p_recurrence: m.recurrence,
        p_recurrence_until: m.recurrence === "none" ? null : m.recurrence_until, p_participants: m.participants,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: async ({ id, scope, m }: { id: string; scope: Scope; m: MeetingInput }) => {
      const { data, error } = await db.rpc("meeting_update", {
        p_meeting: id, p_scope: scope, p_title: m.title, p_description: m.description,
        p_starts_at: m.starts_at, p_ends_at: m.ends_at, p_location: m.location,
        p_video_link: m.video_link, p_participants: m.participants,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: async ({ id, scope }: { id: string; scope: Scope }) => {
      const { data, error } = await db.rpc("meeting_cancel", { p_meeting: id, p_scope: scope });
      if (error) throw error;
      return data as number;
    },
    onSuccess: refresh,
  });
  const respond = useMutation({
    mutationFn: async ({ id, response, scope = "one" }: { id: string; response: "accepted" | "declined"; scope?: Scope }) => {
      const { data, error } = await db.rpc("meeting_respond", { p_meeting: id, p_response: response, p_scope: scope });
      if (error) throw error;
      return data as number;
    },
    onSuccess: refresh,
  });
  return { create, update, cancel, respond };
}
