import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOperatorLineIds } from "@/hooks/useOperatorLineAccess";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Loader2, Target, History } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { getShift, getCurrentFactoryShift, SHIFT_LABEL } from "@/lib/shifts";

interface Line { id: string; name: string; }
interface Msg {
  id: string;
  line_id: string;
  user_id: string;
  user_name: string;
  message: string;
  created_at: string;
}

const LAST_SEEN_KEY = "an_line_chat_last_seen";

function readLastSeen(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "{}"); } catch { return {}; }
}
function writeLastSeen(m: Record<string, string>) {
  try { localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(m)); } catch {}
}

export function LineChatButton() {
  const { user, profile, role } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [lastSeen, setLastSeen] = useState<Record<string, string>>(() => readLastSeen());
  const [unreadTick, setUnreadTick] = useState(0);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [showAllShifts, setShowAllShifts] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { sessionDate, shiftCode } = getCurrentFactoryShift();

  const isStaff = role === "admin" || role === "manager" || role === "maintenance_manager";
  const canUse = isStaff || role === "operator" || role === "engineer";

  const { data: allLines = [] } = useQuery({
    queryKey: ["chat_lines"],
    enabled: !!user && canUse,
    queryFn: async () => {
      const { data } = await supabase.from("lines").select("id,name,active,display_order").eq("active", true).order("display_order");
      return (data ?? []) as (Line & { active: boolean; display_order: number })[];
    },
  });

  const { data: operatorLineIds = [] } = useOperatorLineIds();

  // Which lines this user can access
  const lines = useMemo(() => {
    if (isStaff || role === "engineer") return allLines;
    if (role === "operator") {
      // Prefer operator_line_accounts; fallback to profile.production_line by name
      if (operatorLineIds.length) return allLines.filter((l) => operatorLineIds.includes(l.id));
      const name = profile?.production_line;
      if (name) return allLines.filter((l) => l.name === name);
      return [];
    }
    return [];
  }, [allLines, isStaff, role, operatorLineIds, profile?.production_line]);

  // Default active line
  useEffect(() => {
    if (activeLineId) return;
    if (lines.length) setActiveLineId(lines[0].id);
  }, [lines, activeLineId]);

  // Messages for active line
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["line_chat", activeLineId],
    enabled: !!activeLineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("line_chat_messages" as any)
        .select("*")
        .eq("line_id", activeLineId!)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as Msg[];
    },
  });

  // Keep latest values in a ref so the realtime effect can read them
  // without recreating the channel on every render.
  const ctxRef = useRef({ lines, open, activeLineId, userId: user?.id });
  useEffect(() => {
    ctxRef.current = { lines, open, activeLineId, userId: user?.id };
  }, [lines, open, activeLineId, user?.id]);

  // Realtime subscription for ALL line chat messages (so badges update).
  // Keyed only on [user?.id, canUse] so the channel is created ONCE per session.
  // All .on(...) listeners are registered before .subscribe() and a per-mount
  // suffix in the topic prevents any stale SUBSCRIBED channel collision.
  useEffect(() => {
    if (!user?.id || !canUse) return;
    const topic = `line_chat_${user.id}_${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase.channel(topic);
    ch.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "line_chat_messages" },
      (payload) => {
        const msg = payload.new as Msg;
        const { lines: curLines, open: curOpen, activeLineId: curActive, userId } = ctxRef.current;
        qc.invalidateQueries({ queryKey: ["line_chat", msg.line_id] });
        setUnreadTick((t) => t + 1);
        if (msg.user_id !== userId) {
          const line = curLines.find((l) => l.id === msg.line_id);
          const isViewing = curOpen && curActive === msg.line_id;
          if (!isViewing) {
            toast.message(`${line?.name ?? "Line"} — ${msg.user_name}`, { description: msg.message.slice(0, 120) });
          }
        }
      },
    );
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, canUse, qc]);


  // Mark active channel as read when panel opens or channel changes
  useEffect(() => {
    if (open && activeLineId) {
      const next = { ...readLastSeen(), [activeLineId]: new Date().toISOString() };
      writeLastSeen(next);
      setLastSeen(next);
      setUnreadTick((t) => t + 1);
    }
  }, [open, activeLineId, messages.length]);

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, activeLineId, open]);

  // Compute unread counts per line via a lightweight query
  const { data: unreadPerLine = {} } = useQuery({
    queryKey: ["line_chat_unread", user?.id, unreadTick],
    enabled: !!user && canUse && lines.length > 0,
    queryFn: async () => {
      const seen = readLastSeen();
      const results: Record<string, number> = {};
      const targets = lines;
      await Promise.all(
        targets.map(async (l) => {
          const since = seen[l.id] ?? "1970-01-01T00:00:00Z";
          const { count } = await supabase
            .from("line_chat_messages" as any)
            .select("id", { count: "exact", head: true })
            .eq("line_id", l.id)
            .gt("created_at", since)
            .neq("user_id", user!.id);
          results[l.id] = count ?? 0;
        }),
      );
      return results;
    },
    staleTime: 15_000,
  });

  const totalUnread = Object.values(unreadPerLine).reduce((a, b) => a + b, 0);

  // Presence: track who is viewing the active channel
  useEffect(() => {
    if (!open || !activeLineId || !user) { setOnlineIds(new Set()); return; }
    const channel = supabase.channel(`line_chat_presence_${activeLineId}`, {
      config: { presence: { key: user.id } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, unknown[]>;
        setOnlineIds(new Set(Object.keys(state)));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: user.id,
            name: profile?.name || user.email,
            online_at: new Date().toISOString(),
          });
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [open, activeLineId, user, profile?.name]);

  const send = async () => {
    const body = text.trim();
    if (!body || !activeLineId || !user) return;
    setSending(true);
    const { data: inserted, error } = await supabase
      .from("line_chat_messages" as any)
      .insert({
        line_id: activeLineId,
        user_id: user.id,
        user_name: profile?.name || user.email || "Unknown",
        message: body,
      } as any)
      .select("id")
      .single();
    setSending(false);
    if (error) { toast.error("Failed to send"); return; }
    setText("");
    qc.invalidateQueries({ queryKey: ["line_chat", activeLineId] });
    // Fire push notifications to other participants (best-effort)
    void supabase.functions.invoke("notify-line-chat", {
      body: { line_id: activeLineId, message_id: (inserted as any)?.id },
    }).catch(() => {});
  };

  if (!canUse) return null;

  const activeLine = lines.find((l) => l.id === activeLineId);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative shrink-0" title="Line chat" aria-label="Line chat">
          <MessageSquare className="h-5 w-5" />
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 border-b">
          <SheetTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Line Chat</SheetTitle>
        </SheetHeader>

        {lines.length > 1 && (
          <div className="border-b overflow-x-auto">
            <div className="flex gap-1 p-2">
              {lines.map((l) => {
                const u = unreadPerLine[l.id] ?? 0;
                const active = l.id === activeLineId;
                return (
                  <button
                    key={l.id}
                    onClick={() => setActiveLineId(l.id)}
                    className={`relative shrink-0 text-xs px-3 py-1.5 rounded-md border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"}`}
                  >
                    {l.name}
                    {u > 0 && !active && (
                      <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">{u}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!activeLine ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
            {isStaff ? "Select a line to view its chat." : "No line assigned to your profile."}
          </div>
        ) : (
          <>
            <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Channel</p>
                <p className="text-sm font-medium">{activeLine.name}</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                {onlineIds.size} online
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-muted/20">
              {isLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : messages.length === 0 ? (
                <p className="text-xs text-center text-muted-foreground py-8">No messages yet. Start the conversation.</p>
              ) : (
                messages.map((m) => {
                  const own = m.user_id === user?.id;
                  return (
                    <div key={m.id} className={`flex flex-col ${own ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 ${own ? "bg-primary text-primary-foreground" : "bg-card border"}`}>
                        {!own && (
                          <p className="text-[10px] font-semibold opacity-70 mb-0.5 flex items-center gap-1">
                            {onlineIds.has(m.user_id) && <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />}
                            {m.user_name}
                          </p>
                        )}
                        <p className="text-sm whitespace-pre-wrap break-words">{m.message}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-0.5">{format(new Date(m.created_at), "HH:mm")}</span>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>
            <div className="flex gap-2 p-3 border-t bg-background">
              <Input
                placeholder="Type a message…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                autoComplete="off"
                disabled={sending}
              />
              <Button onClick={() => void send()} disabled={!text.trim() || sending} size="icon" aria-label="Send">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
