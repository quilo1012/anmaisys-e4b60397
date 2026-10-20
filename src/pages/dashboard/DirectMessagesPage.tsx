import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Camera, Info, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { ConversationList, type ListFilter } from "@/components/chat/ConversationList";
import { MessageThread, type UIMessage } from "@/components/chat/MessageThread";
import { Composer } from "@/components/chat/Composer";
import { CreateGroupDialog, GroupInfoSheet } from "@/components/chat/GroupDialogs";
import { ProfilePhotoDialog } from "@/components/chat/ProfilePhotoDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useDMPartners, useDMUnreadBySender, useMarkDMRead, useMySupervisor } from "@/hooks/useDirectMessages";
import {
  chatFilePath, uploadWithProgress, useChatPeople, useConversationLive, useDMSummaries,
  useDMThreadPaged, useGroupThread, useMarkGroupRead, useMyPhoto, useMyGroups, useSendDirect,
  useSendGroupMessage, type UploadedFile,
} from "@/hooks/useChat";
import {
  groupFolder, matchesSearch, mergeMessages, pairFolder, parseConversationKey, sortConversations,
  type ConversationKey, type ConversationSummary,
} from "@/lib/chat";
import { can, type Role } from "@/lib/permissions";
import { invokeFunction } from "@/lib/invokeFunction";
import { logSystemError } from "@/lib/telemetry";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Pending extends UIMessage {
  conv: ConversationKey;
  files: File[];
  replyTo?: string | null;
  /** Written through the employee's door to the supervisor on file (BLOCO 107). */
  door: boolean;
}

const errText = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong";

/** A file already in storage from an earlier try is not a failure on the retry. */
async function upload(path: string, f: File, onProgress: (x: number) => void) {
  try {
    await uploadWithProgress("chat-files", path, f, onProgress);
  } catch (e) {
    if (/exists|duplicate/i.test(errText(e))) return;
    throw e;
  }
}

/**
 * The Communication Hub: private conversations and department/team groups in one place.
 *
 * Who may write to whom, who is in which group and who reads what is decided by the
 * database (RLS and the BLOCO 107/108 functions); this screen only draws what it is
 * given. A private conversation is the pair of people — there is no conversation row,
 * so the same two people can never have two.
 */
export default function DirectMessagesPage() {
  const { user, role } = useAuth();
  const me = user?.id ?? "";
  const [params, setParams] = useSearchParams();

  // The bell links to `?group=<id>`; everything else to `?c=dm:<id>` / `?c=group:<id>`.
  useEffect(() => {
    const g = params.get("group");
    if (g && !params.get("c")) setParams({ c: `group:${g}` }, { replace: true });
  }, [params, setParams]);
  const active = parseConversationKey(params.get("c"));
  const activeKey = active ? (`${active.kind}:${active.id}` as ConversationKey) : null;
  const select = useCallback((k: ConversationKey | null) => setParams(k ? { c: k } : {}), [setParams]);

  const partners = useDMPartners(role);
  const summaries = useDMSummaries();
  const { data: unreadBySender = {} } = useDMUnreadBySender();
  const groups = useMyGroups();
  const mySup = useMySupervisor(role === "employee");
  const groupsNotSetUp = groups.data?.notSetUp ?? false;
  const myPhoto = useMyPhoto();
  const [photoOpen, setPhotoOpen] = useState(false);

  const dmIds = useMemo(() => {
    const ids = new Set<string>((partners.data ?? []).map((p) => p.user_id));
    for (const s of summaries.data ?? []) ids.add(s.partner_id);
    ids.delete(me);
    return [...ids];
  }, [partners.data, summaries.data, me]);
  const people = useChatPeople(useMemo(() => [...dmIds, me].filter(Boolean), [dmIds, me]));

  const conversations = useMemo<ConversationSummary[]>(() => {
    const byPartner = new Map((summaries.data ?? []).map((s) => [s.partner_id, s]));
    const partnerInfo = new Map((partners.data ?? []).map((p) => [p.user_id, p]));
    const dms: ConversationSummary[] = dmIds.map((id) => {
      const s = byPartner.get(id);
      const p = partnerInfo.get(id);
      const person = people.data?.[id];
      const body = s ? (s.last_has_audio && /^🎤/.test(s.last_body) ? "🎤 Voice message" : s.last_body) : null;
      return {
        key: `dm:${id}` as ConversationKey, kind: "dm" as const, id,
        name: person?.name ?? p?.name ?? "Someone",
        subtitle: p?.line_labels ?? person?.job ?? null,
        avatarPath: person?.avatar_path ?? null,
        lastAt: s?.last_at ?? null,
        preview: s ? `${s.last_from_me ? "You: " : ""}${body}` : null,
        unread: unreadBySender[id] ?? s?.unread ?? 0,
      };
    });
    const gs: ConversationSummary[] = (groups.data?.groups ?? []).map((g) => ({
      key: `group:${g.id}` as ConversationKey, kind: "group" as const, id: g.id, name: g.name,
      subtitle: g.kind === "team" ? `Team · ${g.department} · ${g.team}` : `Department · ${g.department}`,
      avatarPath: g.avatar_path,
      lastAt: g.last_at,
      preview: g.last_at ? `${g.last_sender_name ?? "Someone"}: ${g.last_body || (g.last_has_files ? "📎 File" : "")}` : null,
      unread: g.unread,
    }));
    return sortConversations([...gs, ...dms]);
  }, [dmIds, summaries.data, partners.data, people.data, groups.data, unreadBySender]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");
  const shown = conversations.filter((c) => (filter === "all" || c.kind === filter) && matchesSearch(c, search));
  const current = conversations.find((c) => c.key === activeKey) ?? null;
  const group = active?.kind === "group" ? groups.data?.groups.find((g) => g.id === active.id) ?? null : null;

  // A wide screen opens the first conversation; a phone starts on the list.
  useEffect(() => {
    if (!activeKey && conversations.length > 0 && window.matchMedia("(min-width: 768px)").matches) {
      setParams({ c: conversations[0].key }, { replace: true });
    }
  }, [activeKey, conversations, setParams]);

  // ── The open conversation ──
  const dmThread = useDMThreadPaged(active?.kind === "dm" ? active.id : null);
  const groupThread = useGroupThread(active?.kind === "group" ? active.id : null);
  const thread = active?.kind === "group" ? groupThread : dmThread;
  useConversationLive(active);
  const [pending, setPending] = useState<Pending[]>([]);
  const [replyTo, setReplyTo] = useState<UIMessage | null>(null);
  useEffect(() => { setReplyTo(null); }, [activeKey]);

  const groupSenders = useMemo(() => [...new Set(groupThread.messages.map((m) => m.sender_id))], [groupThread.messages]);
  const groupPeople = useChatPeople(groupSenders);

  const serverMessages: UIMessage[] = useMemo(() => {
    if (active?.kind === "group") {
      return groupThread.messages.map((m) => ({
        id: m.id, sender_id: m.sender_id, sender_name: groupPeople.data?.[m.sender_id]?.name ?? "Someone",
        body: m.body, created_at: m.created_at, reply_to_id: m.reply_to_id, attachments: m.chat_attachments ?? [],
      }));
    }
    return dmThread.messages.map((m) => ({
      id: m.id, sender_id: m.sender_id, sender_name: m.sender_name, body: m.message, created_at: m.created_at,
      read_at: m.read_at, audio_path: m.audio_url, attachments: m.chat_attachments ?? [],
    }));
  }, [active?.kind, groupThread.messages, dmThread.messages, groupPeople.data]);

  // A message on its way gives way to the server's copy as soon as that arrives.
  const serverIds = useMemo(() => new Set(serverMessages.map((m) => m.id)), [serverMessages]);
  useEffect(() => { setPending((p) => p.filter((x) => !serverIds.has(x.id))); }, [serverIds]);
  const messages = useMemo(
    () => mergeMessages(serverMessages, pending.filter((p) => p.conv === activeKey && !serverIds.has(p.id))),
    [serverMessages, pending, activeKey, serverIds],
  );

  const threadPeople = useMemo(() => {
    const out: Record<string, { name: string; avatar_path: string | null }> = {};
    for (const src of [people.data, groupPeople.data]) for (const [id, p] of Object.entries(src ?? {})) out[id] = p;
    return out;
  }, [people.data, groupPeople.data]);

  // Reading: whenever the open thread changes while the page is in view.
  const markDM = useMarkDMRead(active?.kind === "dm" ? active.id : null);
  const markGroup = useMarkGroupRead();
  const lastServerId = serverMessages[serverMessages.length - 1]?.id;
  useEffect(() => {
    if (!active || document.visibilityState !== "visible") return;
    if (active.kind === "dm") markDM.mutate();
    else if (!groupsNotSetUp) markGroup.mutate(active.id);
  }, [activeKey, lastServerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sending ──
  const sendGroup = useSendGroupMessage();
  const sendDirect = useSendDirect();
  const supervisorId = mySup.data?.supervisor?.user_id ?? null;
  const supervisorDoor = role === "employee" && active?.kind === "dm" && active.id === supervisorId;

  const patch = (id: string, p: Partial<Pending>) => setPending((all) => all.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const deliver = async (m: Pending) => {
    const target = parseConversationKey(m.conv)!;
    patch(m.id, { status: "sending", error: undefined, progress: m.files.length ? 0 : undefined });
    try {
      const folder = target.kind === "group" ? groupFolder(target.id) : pairFolder(me, target.id);
      const done: UploadedFile[] = [];
      const total = m.files.reduce((n, f) => n + f.size, 0) || 1;
      let sent = 0;
      for (const [i, f] of m.files.entries()) {
        const path = chatFilePath(folder, m.id, f, i);
        await upload(path, f, (x) => patch(m.id, { progress: (sent + x * f.size) / total }));
        sent += f.size;
        done.push({ path, name: f.name });
      }
      if (target.kind === "group") {
        await sendGroup.mutateAsync({ id: m.id, groupId: target.id, body: m.body, replyTo: m.replyTo, files: done });
      } else {
        const id = await sendDirect.mutateAsync({ id: m.id, partnerId: target.id, body: m.body, supervisorDoor: m.door, files: done });
        // The supervisor's door chooses its own id; the copy shown goes when the real one arrives.
        if (id !== m.id) setPending((all) => all.filter((x) => x.id !== m.id));
      }
    } catch (e) {
      patch(m.id, { status: "failed", error: errText(e).slice(0, 80) });
      logSystemError("API_ERROR", `Chat send failed: ${errText(e)}`, { metadata: { conversation: m.conv } });
    }
  };

  const onSend = (text: string, files: File[]) => {
    if (!activeKey || !me) return;
    const m: Pending = {
      id: crypto.randomUUID(), conv: activeKey, sender_id: me, sender_name: "You", body: text,
      created_at: new Date().toISOString(), attachments: [], status: "sending", files,
      replyTo: replyTo?.id ?? null, reply_to_id: replyTo?.id ?? null, door: supervisorDoor,
    };
    setPending((p) => [...p, m]);
    setReplyTo(null);
    void deliver(m);
  };

  const onVoice = async (blob: Blob, transcript: string) => {
    if (active?.kind !== "dm" || !me) return;
    try {
      const ext = blob.type.includes("mp4") || blob.type.includes("mpeg") ? "mp4" : "webm";
      const path = `${me}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("dm-audio").upload(path, blob, { contentType: blob.type || "audio/webm" });
      if (error) throw error;
      await sendDirect.mutateAsync({ id: crypto.randomUUID(), partnerId: active.id, body: transcript || "🎤 Voice message", supervisorDoor: false, audioPath: path });
    } catch (e) {
      toast.error(errText(e));
      logSystemError("RLS_ERROR", `Voice note send failed: ${errText(e)}`, { metadata: { recipientId: active.id } });
    }
  };

  // ── Translate / convert to text, on private messages (as before) ──
  type Extra = { tr?: string; showTr?: boolean; trBusy?: boolean; trFail?: boolean; tx?: string; txBusy?: boolean; txFail?: string };
  const [extras, setExtras] = useState<Record<string, Extra>>({});
  const translate = async (m: UIMessage) => {
    const x = extras[m.id];
    if (x?.tr) { setExtras((s) => ({ ...s, [m.id]: { ...x, showTr: !x.showTr } })); return; }
    setExtras((s) => ({ ...s, [m.id]: { ...x, trBusy: true, trFail: false } }));
    const { data, error } = await invokeFunction<{ translated: string }>("translate-message", { text: m.body });
    setExtras((s) => ({ ...s, [m.id]: { ...s[m.id], trBusy: false, ...(error || !data?.translated ? { trFail: true } : { tr: data.translated, showTr: true }) } }));
  };
  const transcribe = async (m: UIMessage) => {
    if (!m.audio_path) return;
    setExtras((s) => ({ ...s, [m.id]: { ...s[m.id], txBusy: true, txFail: undefined } }));
    try {
      const { data, error } = await invokeFunction<{ text?: string; error?: string }>("transcribe-audio", { path: m.audio_path });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Failed");
      setExtras((s) => ({ ...s, [m.id]: { ...s[m.id], txBusy: false, tx: (data?.text || "").trim() || "(no speech detected)" } }));
    } catch (e) {
      setExtras((s) => ({ ...s, [m.id]: { ...s[m.id], txBusy: false, txFail: errText(e) } }));
    }
  };
  const renderExtras = (m: UIMessage) => {
    const x = extras[m.id] ?? {};
    return (
      <>
        {m.sender_id !== me && m.body && (
          x.trBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : (
            <button type="button" onClick={() => translate(m)} className={cn("hover:text-foreground hover:underline", x.trFail && "text-destructive-strong")}>
              {x.trFail ? "Translation failed · Retry" : x.tr ? (x.showTr ? "Show original" : "Show translation") : "Translate"}
            </button>
          )
        )}
        {m.audio_path && !x.tx && (
          x.txBusy ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Converting…</span> : (
            <button type="button" onClick={() => transcribe(m)} className={cn("hover:text-foreground hover:underline", x.txFail && "text-destructive-strong")} title={x.txFail}>
              {x.txFail ? "Failed · Retry" : "Convert to text"}
            </button>
          )
        )}
      </>
    );
  };
  const shownMessages = useMemo(() => messages.map((m) => {
    const x = extras[m.id];
    if (!x) return m;
    const extra = [x.showTr && x.tr ? `\n— ${x.tr}` : "", x.tx ? `\n🎤 ${x.tx}` : ""].join("");
    return extra ? { ...m, body: m.body + extra } : m;
  }), [messages, extras]);

  // ── Layout ──
  const [newGroup, setNewGroup] = useState(false);
  const [info, setInfo] = useState(false);
  const canCreateGroup = can(role as Role, "chat.groups.manage") && !groupsNotSetUp;
  const listLoading = partners.isLoading || groups.isLoading;
  const listError = partners.error ? errText(partners.error) : groups.error ? errText(groups.error) : null;

  const myName = people.data?.[me]?.name ?? "You";
  const listHeader = (
    <div className="flex items-center gap-3">
      <div className="relative">
        <ChatAvatar name={myName} path={myPhoto.data?.path ?? null} />
        {myPhoto.data && !myPhoto.data.notSetUp && (
          <button type="button" onClick={() => setPhotoOpen(true)}
            className="absolute -bottom-1 -right-1 rounded-full border bg-background p-1 shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Change your photo" title="Change your photo">
            <Camera className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="min-w-0">
        <h1 className="text-base font-semibold leading-tight">Communication Hub</h1>
        <p className="truncate text-xs text-muted-foreground">Private conversations and your groups</p>
      </div>
    </div>
  );

  const loadingThread = thread.isLoading && messages.length === 0;
  const threadError = thread.error ? errText(thread.error) : null;

  return (
    <DashboardLayout>
      <div className="h-[calc(100dvh-10rem)] min-h-[420px] lg:h-[calc(100dvh-7rem)]">
        <div className="grid h-full min-h-0 overflow-hidden rounded-xl border bg-card md:grid-cols-[300px_1fr] lg:grid-cols-[340px_1fr]">
          <aside className={cn("min-h-0 border-r", active ? "hidden md:block" : "block")} aria-label="Conversations">
            <ConversationList
              conversations={shown}
              activeKey={activeKey}
              onSelect={select}
              search={search}
              onSearch={setSearch}
              filter={filter}
              onFilter={setFilter}
              loading={listLoading}
              error={listError}
              onRetry={() => { partners.refetch(); groups.refetch(); summaries.refetch(); }}
              groupsNotSetUp={groupsNotSetUp}
              canCreateGroup={canCreateGroup}
              onNewGroup={() => setNewGroup(true)}
              header={listHeader}
            />
          </aside>

          <section className={cn("min-h-0 flex-col", active ? "flex" : "hidden md:flex")} aria-label={current ? `Conversation with ${current.name}` : "Conversation"}>
            {!active ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                <MessageCircle className="h-10 w-10 opacity-40" aria-hidden />
                <p className="text-sm">Choose a conversation.</p>
              </div>
            ) : (
              <>
                <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
                  <Button size="icon" variant="ghost" className="h-9 w-9 md:hidden" onClick={() => select(null)} aria-label="Back to conversations">
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <ChatAvatar name={current?.name ?? "…"} path={current?.avatarPath} group={active.kind === "group"} />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold">{current?.name ?? "Conversation"}</h2>
                    <p className="truncate text-xs text-muted-foreground">
                      {group ? `${group.member_count} members · ${current?.subtitle}` : current?.subtitle ?? "Private conversation"}
                    </p>
                  </div>
                  {group && (
                    <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setInfo(true)} aria-label="Group details and members">
                      <Info className="h-5 w-5" />
                    </Button>
                  )}
                </header>
                <MessageThread
                  messages={shownMessages}
                  meId={me}
                  people={threadPeople}
                  isGroup={active.kind === "group"}
                  loading={loadingThread}
                  error={threadError}
                  onRetryLoad={() => thread.refetch()}
                  hasOlder={!!thread.hasNextPage}
                  loadingOlder={thread.isFetchingNextPage}
                  onLoadOlder={() => thread.fetchNextPage()}
                  onRetrySend={(m) => { const p = pending.find((x) => x.id === m.id); if (p) void deliver(p); }}
                  onReply={active.kind === "group" ? setReplyTo : undefined}
                  renderExtras={active.kind === "dm" ? renderExtras : undefined}
                  emptyText={active.kind === "group" ? "No messages in this group yet. Say hello." : "No messages yet. Write the first one."}
                />
                <Composer
                  resetKey={activeKey!}
                  onSend={onSend}
                  onVoice={active.kind === "dm" && !supervisorDoor ? onVoice : undefined}
                  replyTo={replyTo ? { name: threadPeople[replyTo.sender_id]?.name ?? replyTo.sender_name, body: replyTo.body } : null}
                  onCancelReply={() => setReplyTo(null)}
                  placeholder={current ? `Message ${current.name}` : "Write a message"}
                />
              </>
            )}
          </section>
        </div>
      </div>
      <ProfilePhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} />
      <CreateGroupDialog open={newGroup} onOpenChange={setNewGroup} onCreated={(id) => select(`group:${id}`)} />
      {group && <GroupInfoSheet group={group} open={info} onOpenChange={setInfo} meId={me} isAdmin={role === "admin"} />}
    </DashboardLayout>
  );
}
