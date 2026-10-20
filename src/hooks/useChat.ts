import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getCurrentFactoryShift, getCurrentShiftStart } from "@/lib/shifts";
import { showDMToast } from "@/components/DMNotificationToast";
import { mergeMessages, storageSafeName, fileType } from "@/lib/chat";

/**
 * Messages, beyond the one-to-one thread `useDirectMessages` already had: groups,
 * photos, files, summaries for the list, and paging.
 *
 * Everything here is BLOCO 108 (`20261019160000`). Until it is pasted the functions and
 * tables answer PGRST202/PGRST205, and each hook below says so (`notSetUp`, or an empty
 * answer the screen can draw) instead of failing — see `pendingRpcs.ts`. The generated
 * `types.ts` learns these names only after the paste, hence the casts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const rpc = (name: string, args?: Record<string, unknown>) => (supabase.rpc as any)(name, args);
const from = (table: string) => (supabase.from as any)(table);

const notThere = (e: { code?: string } | null | undefined) =>
  !!e && (e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42P01" || e.code === "PGRST200");

export const PAGE = 40;

export interface ChatPerson {
  user_id: string;
  name: string;
  avatar_path: string | null;
  job: string | null;
}

export interface ChatAttachment {
  id: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
}

export interface GroupSummary {
  id: string;
  kind: "department" | "team";
  name: string;
  description: string | null;
  department: string;
  team: string | null;
  avatar_path: string | null;
  my_role: "manager" | "member";
  member_count: number;
  last_at: string | null;
  last_sender_name: string | null;
  last_body: string | null;
  last_has_files: boolean;
  unread: number;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  body: string;
  reply_to_id: string | null;
  created_at: string;
  chat_attachments?: ChatAttachment[];
}

export interface DMSummary {
  partner_id: string;
  last_at: string;
  last_body: string;
  last_from_me: boolean;
  last_has_audio: boolean;
  unread: number;
}

/** Names, photos and job titles of the people on screen, by login. */
export function useChatPeople(ids: readonly string[]) {
  const key = useMemo(() => [...new Set(ids)].sort(), [ids]);
  return useQuery({
    queryKey: ["chat_people", key],
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
    meta: { schemaOptional: true },
    queryFn: async (): Promise<Record<string, ChatPerson>> => {
      const { data, error } = await rpc("chat_people", { p_ids: key });
      if (error) {
        if (notThere(error)) return {};
        throw error;
      }
      return Object.fromEntries(((data ?? []) as ChatPerson[]).map((p) => [p.user_id, p]));
    },
  });
}

/** A short-lived link to a private file; renewed before it runs out. */
export function useSignedUrl(bucket: "avatars" | "chat-files", path: string | null | undefined) {
  return useQuery({
    queryKey: ["signed_url", bucket, path],
    enabled: !!path,
    staleTime: 45 * 60_000,
    gcTime: 50 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path!, 3600);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}

export function useMyGroups(enabled = true) {
  // Gate on the session, not the user: during silent re-login the user is restored
  // from the last session while there is no token yet, and the request would go out
  // as anon — 42501 "permission denied", filed as RLS_ERROR by the telemetry.
  const { user, session } = useAuth();
  return useQuery({
    queryKey: ["chat_my_groups", user?.id],
    enabled: enabled && !!session,
    meta: { schemaOptional: true },
    queryFn: async (): Promise<{ notSetUp: boolean; groups: GroupSummary[] }> => {
      const { data, error } = await rpc("chat_my_groups");
      if (error) {
        if (notThere(error)) return { notSetUp: true, groups: [] };
        throw error;
      }
      return { notSetUp: false, groups: (data ?? []) as GroupSummary[] };
    },
  });
}

export function useDMSummaries() {
  const { user, session } = useAuth();
  return useQuery({
    queryKey: ["dm_summaries", user?.id],
    enabled: !!session,
    meta: { schemaOptional: true },
    queryFn: async (): Promise<DMSummary[]> => {
      const { data, error } = await rpc("chat_my_dm_summaries");
      if (error) {
        if (notThere(error)) return [];
        throw error;
      }
      return (data ?? []) as DMSummary[];
    },
  });
}

/**
 * One conversation, newest page first, older pages on request. `table` is the source;
 * attachments come along when BLOCO 108 is in, and are left off when it is not.
 */
function usePagedThread<T extends { id: string; created_at: string }>(
  key: unknown[],
  enabled: boolean,
  page: (withFiles: boolean, before: string | null) => Promise<{ data: T[] | null; error: any }>,
) {
  const q = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      let { data, error } = await page(true, pageParam);
      if (error && notThere(error)) ({ data, error } = await page(false, pageParam));
      if (error) throw error;
      return (data ?? []) as T[];
    },
    getNextPageParam: (last) => (last.length < PAGE ? undefined : last[last.length - 1].created_at),
  });
  const messages = useMemo(() => mergeMessages(...(q.data?.pages ?? [])), [q.data]);
  return { ...q, messages };
}

export function useGroupThread(groupId: string | null) {
  return usePagedThread<GroupMessage>(["chat_group_thread", groupId], !!groupId, async (withFiles, before) => {
    let s = from("chat_group_messages")
      .select(withFiles ? "*, chat_attachments(id,storage_path,file_name,content_type,size_bytes)" : "*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE);
    if (before) s = s.lt("created_at", before);
    return s;
  });
}

export interface PagedDM {
  id: string;
  sender_id: string;
  sender_name: string;
  recipient_id: string;
  message: string;
  image_url: string | null;
  audio_url: string | null;
  read_at: string | null;
  created_at: string;
  chat_attachments?: ChatAttachment[];
}

/**
 * The private thread with one person, paged. An operator's tablet is shared by a
 * crew, so it shows the current shift only — the same rule `useDMThread` has.
 */
export function useDMThreadPaged(partnerId: string | null) {
  const { user, role, session } = useAuth();
  const isOperator = role === "operator";
  const shift = getCurrentFactoryShift();
  const shiftToken = isOperator ? `${shift.sessionDate}-${shift.shiftCode}` : "all";
  return usePagedThread<PagedDM>(["dm_thread", user?.id, partnerId, "paged", shiftToken], !!session && !!partnerId, async (withFiles, before) => {
    let s = (supabase.from("direct_messages") as any)
      .select(withFiles ? "*, chat_attachments(id,storage_path,file_name,content_type,size_bytes)" : "*")
      .or(`and(sender_id.eq.${user!.id},recipient_id.eq.${partnerId}),and(sender_id.eq.${partnerId},recipient_id.eq.${user!.id})`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE);
    if (isOperator) s = s.gte("created_at", getCurrentShiftStart().toISOString());
    if (before) s = s.lt("created_at", before);
    return s;
  });
}

/**
 * Keeps the open conversation and the list true while the screen is open: a new
 * message, a file recorded a moment after its message, a membership change. Realtime
 * only says "something changed"; the rows are re-read from the database, which stays
 * the record. On a reconnect, or when the device comes back online, everything is
 * re-read, so nothing missed while away stays missing.
 */
export function useConversationLive(conv: { kind: "dm" | "group"; id: string } | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  useEffect(() => {
    if (!user || !conv) return;
    const refreshThread = () => {
      if (conv.kind === "group") qc.invalidateQueries({ queryKey: ["chat_group_thread", conv.id] });
      else qc.invalidateQueries({ queryKey: ["dm_thread", user.id, conv.id] });
    };
    const refreshAll = () => {
      refreshThread();
      qc.invalidateQueries({ queryKey: ["chat_my_groups"] });
      qc.invalidateQueries({ queryKey: ["dm_summaries"] });
      qc.invalidateQueries({ queryKey: ["chat_group_people", conv.id] });
    };
    let subscribedOnce = false;
    const ch = supabase.channel(`conv_${conv.kind}_${conv.id}_${user.id}`);
    if (conv.kind === "group") {
      ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_group_messages", filter: `group_id=eq.${conv.id}` }, refreshAll)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_group_members", filter: `group_id=eq.${conv.id}` }, refreshAll);
    }
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_attachments" }, refreshThread)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (subscribedOnce) refreshAll(); // a reconnect: re-read what was missed
          subscribedOnce = true;
        }
      });
    window.addEventListener("online", refreshAll);
    return () => {
      window.removeEventListener("online", refreshAll);
      supabase.removeChannel(ch);
    };
  }, [user, conv?.kind, conv?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Group messages for the bell and the badge, wherever the person is in the app. RLS
 * delivers only the groups they are in. Says who and where, never what.
 */
export function useGroupAlerts(enabled: boolean) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const navigate = useNavigate();
  const groups = useMyGroups(enabled);
  const unread = (groups.data?.groups ?? []).reduce((n, g) => n + (g.unread ?? 0), 0);
  const notSetUp = groups.data?.notSetUp ?? true;
  const names = useRef<Record<string, string>>({});
  names.current = Object.fromEntries((groups.data?.groups ?? []).map((g) => [g.id, g.name]));
  useEffect(() => {
    if (!user || notSetUp || !enabled) return;
    const ch = supabase
      .channel(`chat_group_alerts_${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_group_messages" }, (payload) => {
        const row = payload.new as GroupMessage;
        qc.invalidateQueries({ queryKey: ["chat_my_groups"] });
        if (!row || row.sender_id === user.id) return;
        const here = new URLSearchParams(window.location.search).get("c");
        if (window.location.pathname === "/dashboard/communication" && here === `group:${row.group_id}`) return;
        showDMToast({
          senderName: names.current[row.group_id] ?? "A group",
          onOpen: () => navigate(`/dashboard/communication?c=group:${row.group_id}`),
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, notSetUp, enabled, qc, navigate]);
  return unread;
}

export function useMarkGroupRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await rpc("chat_mark_group_read", { p_group: groupId });
      if (error && !notThere(error)) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat_my_groups"] });
      qc.invalidateQueries({ queryKey: ["my_notifications"] });
    },
  });
}

/* ── Files ───────────────────────────────────────────────────────────────── */

export interface UploadedFile {
  path: string;
  name: string;
}

/**
 * Uploads one file to a private bucket with progress. supabase-js has no progress
 * callback, so this is the same request it makes (`POST /storage/v1/object/...` with
 * the user's token), sent with XHR. The bucket checks the type and size again.
 */
export async function uploadWithProgress(
  bucket: "chat-files" | "avatars", path: string, file: File, onProgress: (fraction: number) => void,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has ended. Sign in again.");
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  const url = `${base}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", key);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", fileType(file) || "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(1); resolve(); return; }
      let msg = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        msg = body?.message || body?.error || msg;
      } catch { /* keep the status */ }
      if (xhr.status === 413 || /size/i.test(msg)) msg = `${file.name} is too big`;
      else if (/mime|type/i.test(msg)) msg = `${file.name}: this kind of file cannot be sent`;
      else if (xhr.status === 403 || (xhr.status === 400 && /row-level|policy/i.test(msg))) msg = "You cannot send files to this conversation";
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("The connection dropped while uploading. Try again."));
    xhr.send(file);
  });
}

export function chatFilePath(folder: string, messageId: string, file: File, index: number) {
  return `${folder}/${messageId}/${index}-${storageSafeName(file.name)}`;
}

export async function recordAttachments(target: { groupMessageId?: string; directMessageId?: string }, files: UploadedFile[]) {
  if (!files.length) return;
  const { error } = await rpc("chat_record_attachments", {
    p_group_message: target.groupMessageId ?? null,
    p_direct_message: target.directMessageId ?? null,
    p_files: files,
  });
  if (error) throw error;
}

/* ── Groups ──────────────────────────────────────────────────────────────── */

export function useSendGroupMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; groupId: string; body: string; replyTo?: string | null; files?: UploadedFile[] }) => {
      const { data, error } = await rpc("chat_send_group_message", {
        p_id: v.id, p_group: v.groupId, p_body: v.body, p_reply_to: v.replyTo ?? null, p_files: v.files ?? [],
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_id, v) => {
      qc.invalidateQueries({ queryKey: ["chat_group_thread", v.groupId] });
      qc.invalidateQueries({ queryKey: ["chat_my_groups"] });
    },
  });
}

export function useGroupScope(enabled: boolean) {
  return useQuery({
    queryKey: ["chat_my_group_scope"],
    enabled,
    meta: { schemaOptional: true },
    queryFn: async (): Promise<{ department: string; teams: string[] }[]> => {
      const { data, error } = await rpc("chat_my_group_scope");
      if (error) {
        if (notThere(error)) return [];
        throw error;
      }
      return (data ?? []) as { department: string; teams: string[] }[];
    },
  });
}

export function useEligibleMembers(department: string | null, team: string | null) {
  return useQuery({
    queryKey: ["chat_eligible_members", department, team],
    enabled: !!department,
    queryFn: async (): Promise<ChatPerson[]> => {
      const { data, error } = await rpc("chat_eligible_members", { p_department: department, p_team: team });
      if (error) throw error;
      return (data ?? []) as ChatPerson[];
    },
  });
}

export interface GroupPerson extends ChatPerson {
  role: "manager" | "member";
  joined_at: string;
}

export function useGroupPeople(groupId: string | null) {
  return useQuery({
    queryKey: ["chat_group_people", groupId],
    enabled: !!groupId,
    queryFn: async (): Promise<GroupPerson[]> => {
      const { data, error } = await rpc("chat_group_people", { p_group: groupId });
      if (error) throw error;
      return (data ?? []) as GroupPerson[];
    },
  });
}

function useGroupMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat_my_groups"] });
      qc.invalidateQueries({ queryKey: ["chat_group_people"] });
    },
  });
}

async function call(name: string, args: Record<string, unknown>) {
  const { data, error } = await rpc(name, args);
  if (error) throw error;
  return data;
}

export const useCreateGroup = () => useGroupMutation((v: {
  kind: "department" | "team"; name: string; department: string; team: string | null; description: string; members: string[];
}) => call("chat_create_group", {
  p_kind: v.kind, p_name: v.name, p_department: v.department, p_team: v.team,
  p_description: v.description, p_members: v.members,
}) as Promise<string>);

export const useAddMembers = () => useGroupMutation((v: { groupId: string; members: string[] }) =>
  call("chat_add_members", { p_group: v.groupId, p_members: v.members }));

export const useRemoveMember = () => useGroupMutation((v: { groupId: string; userId: string }) =>
  call("chat_remove_member", { p_group: v.groupId, p_user: v.userId }));

export const useSetMemberRole = () => useGroupMutation((v: { groupId: string; userId: string; role: "manager" | "member" }) =>
  call("chat_set_member_role", { p_group: v.groupId, p_user: v.userId, p_role: v.role }));

export const useUpdateGroup = () => useGroupMutation((v: { groupId: string; name: string; description: string; avatarPath: string | null }) =>
  call("chat_update_group", { p_group: v.groupId, p_name: v.name, p_description: v.description, p_avatar_path: v.avatarPath }));

/* ── Photos ──────────────────────────────────────────────────────────────── */

/** Uploads a photo to the person's own folder and makes it theirs. */
export function useSetMyPhoto() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ file, previous }: { file: File | null; previous?: string | null }) => {
      if (!user) throw new Error("Sign in first");
      let path: string | null = null;
      if (file) {
        const ext = fileType(file) === "image/png" ? "png" : fileType(file) === "image/webp" ? "webp" : "jpg";
        path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        await uploadWithProgress("avatars", path, file, () => {});
      }
      const { error } = await rpc("set_avatar", { p_path: path });
      if (error) throw error;
      // The old file is nobody's now; tidy it away (best effort — the row is the record).
      if (previous && previous !== path && previous.startsWith(`${user.id}/`)) {
        await supabase.storage.from("avatars").remove([previous]).catch(() => {});
      }
      return path;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat_people"] });
      qc.invalidateQueries({ queryKey: ["my_avatar"] });
    },
  });
}

/**
 * The signed-in person's photo, through `chat_people` (SECURITY DEFINER).
 *
 * NOT `profiles.select("avatar_path")`: `profiles` is readable column by column
 * (20260724130000_secure_labor_rate.sql keeps `labor_rate` out), and a column added
 * later is not in that list. Reading it straight from the table answered
 * "permission denied for table profiles" to everybody, admin included, on 20/10 — the
 * "You do not have access to this" on Messages — and hid the photo button.
 * Guarded by src/__tests__/profilesAreReadOnlyByGrantedColumns.test.ts.
 */
export function useMyPhoto() {
  const { user, session } = useAuth();
  return useQuery({
    queryKey: ["my_avatar", user?.id],
    enabled: !!session && !!user,
    meta: { schemaOptional: true },
    queryFn: async (): Promise<{ notSetUp: boolean; path: string | null }> => {
      const { data, error } = await rpc("chat_people", { p_ids: [user!.id] });
      if (error) {
        if (notThere(error)) return { notSetUp: true, path: null };
        throw error;
      }
      return { notSetUp: false, path: ((data ?? []) as ChatPerson[])[0]?.avatar_path ?? null };
    },
  });
}

/* ── Private messages, with files ───────────────────────────────────────── */

/**
 * Sends a private message with a client-chosen id, so a retry is the same row (a
 * repeated insert answers 23505 and is taken as done). An employee writing to the
 * supervisor on file goes through `message_my_supervisor` (BLOCO 107) — their only
 * door that starts a conversation, and the one that rings the supervisor's bell.
 * Files go up first, into the pair's folder, and are recorded against the row after.
 */
export function useSendDirect() {
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  return useMutation({
    mutationFn: async (v: {
      id: string; partnerId: string; body: string; supervisorDoor: boolean;
      files?: UploadedFile[]; audioPath?: string | null;
    }) => {
      if (!user) throw new Error("Sign in first");
      const files = v.files ?? [];
      const text = v.body.trim() || (files.length ? `📎 ${files.map((f) => f.name).join(", ")}` : "");
      let id = v.id;
      if (v.supervisorDoor) {
        const { data, error } = await rpc("message_my_supervisor", { p_message: text });
        if (error) throw error;
        id = data as string;
      } else {
        const { error } = await (supabase.from("direct_messages") as any).insert({
          id,
          sender_id: user.id,
          sender_name: profile?.name || user.email || "Unknown",
          recipient_id: v.partnerId,
          message: text,
          audio_url: v.audioPath ?? null,
        });
        if (error && error.code !== "23505") throw error;
      }
      await recordAttachments({ directMessageId: id }, files);
      return id;
    },
    onSuccess: (_id, v) => {
      qc.invalidateQueries({ queryKey: ["dm_thread", user?.id, v.partnerId] });
      qc.invalidateQueries({ queryKey: ["dm_summaries"] });
    },
  });
}
