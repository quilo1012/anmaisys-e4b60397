import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, ArrowDown, Check, CheckCheck, Download, FileText, Loader2, Reply, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { useSignedUrl, type ChatAttachment } from "@/hooks/useChat";
import { CHAT_FILE_TYPES, formatBytes, layoutThread } from "@/lib/chat";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface UIMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
  /** Private messages only: when the other person read it. */
  read_at?: string | null;
  audio_path?: string | null;
  reply_to_id?: string | null;
  attachments: ChatAttachment[];
  /** A message on its way, or one that did not get there. */
  status?: "sending" | "failed";
  /** Upload progress of a message on its way, 0–1. */
  progress?: number;
  error?: string;
}

function VoiceNote({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  useEffect(() => {
    let live = true;
    supabase.storage.from("dm-audio").createSignedUrl(path, 3600).then(({ data, error }) => {
      if (!live) return;
      if (error || !data?.signedUrl) setState("failed");
      else { setUrl(data.signedUrl); setState("ok"); }
    });
    return () => { live = false; };
  }, [path]);
  if (state === "loading") return <span className="mt-1 flex items-center gap-1 text-xs opacity-70"><Loader2 className="h-3 w-3 animate-spin" /> Loading voice…</span>;
  if (state === "failed" || !url) return <span className="mt-1 block text-xs opacity-70">Voice message unavailable</span>;
  return <audio controls src={url} className="mt-1 h-9 max-w-full" />;
}

/** An image shows inline; anything else is a card that downloads through a signed link. */
function Attachment({ a, own }: { a: ChatAttachment; own: boolean }) {
  const isImage = a.content_type.startsWith("image/");
  const { data: url, isError, refetch, isLoading } = useSignedUrl("chat-files", a.storage_path);
  if (isImage && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 block overflow-hidden rounded-md">
        <img src={url} alt={a.file_name} loading="lazy" className="max-h-64 w-auto max-w-full object-contain" />
      </a>
    );
  }
  return (
    <div className={cn("mt-1 flex items-center gap-2 rounded-md border px-2 py-1.5", own ? "border-primary-foreground/25" : "border-border bg-background/60")}>
      <FileText className="h-5 w-5 shrink-0 opacity-80" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{a.file_name}</span>
        <span className="block text-2xs opacity-70">{CHAT_FILE_TYPES[a.content_type] ?? "File"} · {formatBytes(a.size_bytes)}</span>
      </span>
      {isError ? (
        <button type="button" onClick={() => refetch()} className="text-2xs underline" aria-label={`Retry ${a.file_name}`}>Retry</button>
      ) : (
        <a
          href={url ?? undefined}
          download={a.file_name}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!url}
          aria-label={`Download ${a.file_name}`}
          className={cn("rounded p-1 hover:bg-black/10", !url && "pointer-events-none opacity-50")}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </a>
      )}
    </div>
  );
}

export function MessageThread({
  messages, meId, people, isGroup, loading, error, onRetryLoad, hasOlder, loadingOlder, onLoadOlder,
  onRetrySend, onReply, renderExtras, emptyText,
}: {
  messages: UIMessage[];
  meId: string;
  people: Record<string, { name: string; avatar_path: string | null }>;
  isGroup: boolean;
  loading: boolean;
  error: string | null;
  onRetryLoad: () => void;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onRetrySend: (m: UIMessage) => void;
  onReply?: (m: UIMessage) => void;
  /** Translate / convert-to-text controls of a private message. */
  renderExtras?: (m: UIMessage) => React.ReactNode;
  emptyText: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const lastId = messages[messages.length - 1]?.id;
  const firstId = messages[0]?.id;
  const prevHeight = useRef(0);
  const prevFirst = useRef<string | undefined>(undefined);

  // New message at the bottom: follow it if the reader was at the bottom (or sent it).
  // Older page added at the top: keep the reader where they were.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevFirst.current && firstId !== prevFirst.current && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (atBottom.current || messages[messages.length - 1]?.sender_id === meId) {
      el.scrollTop = el.scrollHeight;
    } else {
      setShowJump(true);
    }
    prevHeight.current = el.scrollHeight;
    prevFirst.current = firstId;
  }, [lastId, firstId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setShowJump(false);
    prevHeight.current = el.scrollHeight;
    if (el.scrollTop < 60 && hasOlder && !loadingOlder) onLoadOlder();
  };

  const byId = new Map(messages.map((m) => [m.id, m]));
  const rows = layoutThread(messages);

  if (loading) {
    return (
      <div className="flex-1 space-y-4 p-4" aria-busy="true" aria-label="Loading messages">
        {[60, 40, 70, 30].map((w, i) => (
          <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
            <Skeleton className="h-10 rounded-2xl" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <AlertCircle className="h-6 w-6 text-destructive-strong" aria-hidden />
        <p className="text-muted-foreground">Messages could not be loaded. {error}</p>
        <Button size="sm" variant="outline" onClick={onRetryLoad} className="gap-1.5"><RotateCw className="h-3.5 w-3.5" /> Try again</Button>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-3 py-4 sm:px-5"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {hasOlder && (
          <div className="mb-3 flex justify-center">
            <Button size="sm" variant="ghost" onClick={onLoadOlder} disabled={loadingOlder} className="h-7 text-xs">
              {loadingOlder ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Earlier messages
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">{emptyText}</p>
        )}
        {rows.map((r, i) => {
          if (r.day) {
            return (
              <div key={`d${i}`} className="my-4 flex items-center gap-3" role="separator" aria-label={r.day}>
                <span className="h-px flex-1 bg-border" />
                <span className="text-2xs font-medium text-muted-foreground">{r.day}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            );
          }
          const m = r.message!;
          const own = m.sender_id === meId;
          const who = people[m.sender_id]?.name ?? m.sender_name;
          const quoted = m.reply_to_id ? byId.get(m.reply_to_id) : null;
          const time = new Date(m.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          return (
            <div key={m.id} className={cn("group flex gap-2", own ? "justify-end" : "justify-start", r.startsRun ? "mt-3" : "mt-0.5")}>
              {!own && isGroup && (
                <div className="w-8 shrink-0">
                  {r.startsRun && <ChatAvatar name={who} path={people[m.sender_id]?.avatar_path} size="sm" />}
                </div>
              )}
              <div className={cn("flex max-w-[85%] flex-col sm:max-w-[70%]", own ? "items-end" : "items-start")}>
                {!own && isGroup && r.startsRun && (
                  <span className="mb-0.5 px-1 text-2xs font-semibold text-muted-foreground">{who}</span>
                )}
                <div
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm shadow-sm break-words max-w-full",
                    own ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
                    m.status === "sending" && "opacity-70",
                    m.status === "failed" && "ring-2 ring-destructive",
                  )}
                >
                  {quoted && (
                    <div className={cn("mb-1 border-l-2 pl-2 text-xs opacity-80", own ? "border-primary-foreground/50" : "border-primary/50")}>
                      <span className="font-semibold">{people[quoted.sender_id]?.name ?? quoted.sender_name}</span>
                      <span className="line-clamp-2">{quoted.body || "📎 File"}</span>
                    </div>
                  )}
                  {/* Text is text: React escapes it; nothing here is ever HTML. */}
                  {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                  {m.audio_path && <VoiceNote path={m.audio_path} />}
                  {m.attachments.map((a) => <Attachment key={a.id} a={a} own={own} />)}
                  {m.status === "sending" && m.progress !== undefined && m.progress < 1 && (
                    <div className="mt-1.5 h-1 w-32 overflow-hidden rounded bg-primary-foreground/30" role="progressbar" aria-valuenow={Math.round(m.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Uploading">
                      <div className="h-full bg-primary-foreground transition-[width]" style={{ width: `${Math.round(m.progress * 100)}%` }} />
                    </div>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 px-1 text-2xs text-muted-foreground">
                  {m.status === "failed" ? (
                    <button type="button" onClick={() => onRetrySend(m)} className="flex items-center gap-1 font-medium text-destructive-strong hover:underline">
                      <AlertCircle className="h-3 w-3" /> {m.error ? `${m.error} · ` : "Not sent · "}Retry
                    </button>
                  ) : m.status === "sending" ? (
                    <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Sending</span>
                  ) : (
                    <>
                      <time dateTime={m.created_at}>{time}</time>
                      {own && !isGroup && (m.read_at
                        ? <CheckCheck className="h-3.5 w-3.5 text-primary" aria-label="Read" />
                        : <Check className="h-3.5 w-3.5" aria-label="Delivered" />)}
                      {onReply && (
                        <button
                          type="button"
                          onClick={() => onReply(m)}
                          className="flex items-center gap-0.5 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                          aria-label={`Reply to ${who}`}
                        >
                          <Reply className="h-3 w-3" /> Reply
                        </button>
                      )}
                      {renderExtras?.(m)}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {showJump && (
        <Button
          size="icon"
          variant="secondary"
          className="absolute bottom-3 right-4 h-9 w-9 rounded-full shadow-md"
          aria-label="Jump to newest message"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
            setShowJump(false);
          }}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
