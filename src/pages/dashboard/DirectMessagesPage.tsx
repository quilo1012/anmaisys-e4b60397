import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  useDMPartners,
  useDMThread,
  useSendDM,
  useMarkDMRead,
  useTranslateMessage,
  type DMPartner,
} from "@/hooks/useDirectMessages";
import { MessageCircle, Send, Loader2, Search, Languages, Clock } from "lucide-react";
import { format } from "date-fns";
import { getShiftStartISO } from "@/lib/shifts";
import { cn } from "@/lib/utils";

const STAFF_ROLES = ["admin", "supervisor", "manager", "maintenance_manager"];

interface TranslationState {
  text?: string;
  shown: boolean;
  loading: boolean;
}

function initials(name: string) {
  const parts = (name || "?").trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export default function DirectMessagesPage() {
  const { user, role } = useAuth();
  const { language } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: partners = [], isLoading: partnersLoading } = useDMPartners(role);
  const [filter, setFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [translations, setTranslations] = useState<Record<string, TranslationState>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const isStaff = !!role && STAFF_ROLES.includes(role);
  // Operators only see the current shift; staff keep the full saved history.
  const sinceISO = useMemo(() => (isStaff ? null : getShiftStartISO()), [isStaff]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q),
    );
  }, [partners, filter]);

  // Deep-link support: /dashboard/messages?dm=<partnerId> (from a notification).
  useEffect(() => {
    const dm = searchParams.get("dm");
    if (dm && partners.some((p) => p.user_id === dm)) {
      setActiveId(dm);
      searchParams.delete("dm");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, partners, setSearchParams]);

  // Auto-select first partner (esp. for operators who have 1 supervisor usually)
  useEffect(() => {
    if (!activeId && partners.length > 0) setActiveId(partners[0].user_id);
  }, [partners, activeId]);

  const active: DMPartner | undefined = partners.find((p) => p.user_id === activeId);
  const { data: thread = [], isLoading: threadLoading } = useDMThread(activeId, sinceISO);
  const sendMsg = useSendDM();
  const markRead = useMarkDMRead(activeId);
  const translate = useTranslateMessage();

  const handleTranslate = async (id: string, message: string) => {
    const cur = translations[id];
    if (cur?.text) {
      setTranslations((t) => ({ ...t, [id]: { ...cur, shown: !cur.shown } }));
      return;
    }
    setTranslations((t) => ({ ...t, [id]: { shown: true, loading: true } }));
    try {
      const text = await translate.mutateAsync({ text: message, targetLang: language });
      setTranslations((t) => ({ ...t, [id]: { text, shown: true, loading: false } }));
    } catch {
      setTranslations((t) => ({ ...t, [id]: { shown: false, loading: false } }));
      toast.error(language === "pt" ? "Falha ao traduzir" : "Translation failed");
    }
  };

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

  const title =
    role === "admin" || role === "supervisor" || role === "manager"
      ? "Chat with Operators"
      : "Chat with Supervisor";

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
              {active && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {isStaff
                    ? language === "pt"
                      ? "Histórico completo salvo"
                      : "Full history saved"
                    : language === "pt"
                      ? "Mostrando apenas o turno atual"
                      : "Showing current shift only"}
                </p>
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
                          const tr = translations[m.id];
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
                                {tr?.shown && tr.text && (
                                  <p
                                    className={cn(
                                      "mt-1 border-t pt-1 whitespace-pre-wrap italic",
                                      isOwn
                                        ? "border-primary-foreground/25 text-primary-foreground/85"
                                        : "border-border text-muted-foreground",
                                    )}
                                  >
                                    {tr.text}
                                  </p>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground">
                                  {format(new Date(m.created_at), "dd/MM HH:mm")}
                                  {isOwn && m.read_at && " · Read"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleTranslate(m.id, m.message)}
                                  disabled={tr?.loading}
                                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                                >
                                  {tr?.loading ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Languages className="h-3 w-3" />
                                  )}
                                  {tr?.shown && tr.text
                                    ? language === "pt"
                                      ? "Ocultar"
                                      : "Hide"
                                    : language === "pt"
                                      ? "Traduzir"
                                      : "Translate"}
                                </button>
                              </div>
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
