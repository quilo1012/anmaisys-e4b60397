import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import {
  useDMPartners,
  useDMThread,
  useSendDM,
  useMarkDMRead,
  type DMPartner,
} from "@/hooks/useDirectMessages";
import { MessageCircle, Send, Loader2, Search } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { invokeFunction } from "@/lib/invokeFunction";

type TranslationState = {
  text?: string;
  loading?: boolean;
  error?: boolean;
  show?: boolean;
};

function initials(name: string) {
  const parts = (name || "?").trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export default function DirectMessagesPage() {
  const { user, role } = useAuth();
  const { data: partners = [], isLoading: partnersLoading } = useDMPartners(role);
  const [filter, setFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [translations, setTranslations] = useState<Record<string, TranslationState>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleTranslate = async (id: string, text: string) => {
    const existing = translations[id];
    if (existing?.text) {
      setTranslations((s) => ({ ...s, [id]: { ...existing, show: !existing.show } }));
      return;
    }
    setTranslations((s) => ({ ...s, [id]: { loading: true } }));
    const { data, error } = await invokeFunction<{ translated: string }>(
      "translate-message",
      { text },
    );
    if (error || !data?.translated) {
      setTranslations((s) => ({ ...s, [id]: { error: true } }));
      return;
    }
    setTranslations((s) => ({ ...s, [id]: { text: data.translated, show: true } }));
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q),
    );
  }, [partners, filter]);

  // Auto-select first partner (esp. for operators who have 1 admin usually)
  useEffect(() => {
    if (!activeId && partners.length > 0) setActiveId(partners[0].user_id);
  }, [partners, activeId]);

  const active: DMPartner | undefined = partners.find((p) => p.user_id === activeId);
  const { data: thread = [], isLoading: threadLoading } = useDMThread(activeId);
  const sendMsg = useSendDM();
  const markRead = useMarkDMRead(activeId);

  useEffect(() => {
    if (activeId) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, thread.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg || !activeId) return;
    setText("");
    try {
      await sendMsg.mutateAsync({ recipientId: activeId, message: msg });
    } catch (e) {
      setText(msg);
    }
  };

  const isStaff =
    role === "admin" ||
    role === "supervisor" ||
    role === "manager" ||
    role === "maintenance_manager" ||
    role === "warehouse";
  const title = isStaff ? "Chat with Operators" : "Chat with Team";

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
          {/* Users sidebar */}
          <Card className="h-[70vh] flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Users</CardTitle>
              <div className="relative mt-2">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Filter by name..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full">
                <div className="p-2 space-y-1">
                  {partnersLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : filtered.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      No users found.
                    </p>
                  ) : (
                    filtered.map((p) => (
                      <button
                        key={p.user_id}
                        onClick={() => setActiveId(p.user_id)}
                        className={cn(
                          "w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent",
                          activeId === p.user_id && "bg-accent",
                        )}
                      >
                        <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                          {initials(p.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          {p.line_labels && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {p.line_labels}
                            </p>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Chat pane */}
          <Card className="h-[70vh] flex flex-col">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">
                {active ? active.name : "Select a user to start chatting"}
              </CardTitle>
              {active?.email && (
                <p className="text-xs text-muted-foreground">{active.email}</p>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">
              {!active ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                  Select a user from the left
                </div>
              ) : (
                <>
                  <ScrollArea className="flex-1 px-4 py-3">
                    {threadLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : thread.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-8">
                        No messages yet. Say hi 👋
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {thread.map((m) => {
                          const isOwn = m.sender_id === user?.id;
                          return (
                            <div
                              key={m.id}
                              className={cn(
                                "flex flex-col",
                                isOwn ? "items-end" : "items-start",
                              )}
                            >
                              <div
                                className={cn(
                                  "max-w-[75%] rounded-lg px-3 py-2 text-sm break-words",
                                  isOwn
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted",
                                )}
                              >
                                {!isOwn && (
                                  <p className="text-[10px] font-semibold opacity-70 mb-0.5">
                                    {m.sender_name}
                                  </p>
                                )}
                                <p className="whitespace-pre-wrap">{m.message}</p>
                              </div>
                              <span className="text-[10px] text-muted-foreground mt-0.5">
                                {format(new Date(m.created_at), "dd/MM HH:mm")}
                                {isOwn && m.read_at && " · Read"}
                              </span>
                            </div>
                          );
                        })}
                        <div ref={bottomRef} />
                      </div>
                    )}
                  </ScrollArea>
                  <div className="border-t p-2 flex gap-2">
                    <Input
                      placeholder="Type a message..."
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      className="flex-1"
                    />
                    <Button
                      size="icon"
                      onClick={handleSend}
                      disabled={!text.trim() || sendMsg.isPending}
                    >
                      {sendMsg.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
