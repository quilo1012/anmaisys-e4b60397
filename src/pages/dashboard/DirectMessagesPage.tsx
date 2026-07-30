import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
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
  useDMUnreadBySender,
  type DMPartner,
} from "@/hooks/useDirectMessages";
import { MessageCircle, Send, Loader2, Search, Mic, Captions, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { invokeFunction } from "@/lib/invokeFunction";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logSystemError } from "@/lib/telemetry";

/** Plays a private voice note: resolves a short-lived signed URL for the stored path. */
function VoiceNote({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let ok = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.storage.from("dm-audio").createSignedUrl(path, 3600);
        if (error) throw error;
        if (ok) setUrl(data?.signedUrl ?? null);
      } catch { /* ignore — show a retry affordance */ } finally { if (ok) setLoading(false); }
    })();
    return () => { ok = false; };
  }, [path]);
  if (loading) return <div className="mt-1 flex items-center gap-1 text-xs opacity-70"><Loader2 className="h-3 w-3 animate-spin" /> Loading voice…</div>;
  if (!url) return <div className="mt-1 text-xs opacity-70">Voice message unavailable</div>;
  return <audio controls src={url} className="mt-1 max-w-full h-9" />;
}

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
  const { data: unreadBySender = {} } = useDMUnreadBySender();
  const [filter, setFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [translations, setTranslations] = useState<Record<string, TranslationState>>({});
  const [transcriptions, setTranscriptions] = useState<Record<string, { text?: string; loading?: boolean; error?: string }>>({});

  // Convert an existing voice note to text (server-side, Gemini via the AI
  // gateway) — the browser can only transcribe live mic, not a stored file.
  const handleTranscribe = async (id: string, path: string) => {
    const existing = transcriptions[id];
    if (existing?.text || existing?.loading) return;
    setTranscriptions((p) => ({ ...p, [id]: { loading: true } }));
    try {
      const { data, error } = await invokeFunction<{ text?: string; error?: string }>("transcribe-audio", { path });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Failed");
      let text = (data?.text || "").trim();
      // Transcription comes back verbatim in the spoken language; translate it to
      // English for the admin view (reuses the deployed translate-message fn).
      if (text) {
        try {
          const { data: tr } = await invokeFunction<{ translated?: string }>("translate-message", { text });
          const en = (tr?.translated || "").trim();
          if (en) text = en;
        } catch { /* keep the original transcript if translation fails */ }
      }
      setTranscriptions((p) => ({ ...p, [id]: { text: text || "(no speech detected)" } }));
    } catch (e: any) {
      // Surface the real reason (not-deployed 404, unsupported audio format,
      // rate limit / credits, etc.) instead of a silent "failed" — otherwise the
      // cause is invisible and impossible to fix.
      const msg = (e?.message || "Transcription failed").toString();
      setTranscriptions((p) => ({ ...p, [id]: { error: msg } }));
      toast.error(msg);
      logSystemError("API_ERROR", `Voice transcription failed: ${msg}`, { metadata: { messageId: id, path } });
    }
  };
  const bottomRef = useRef<HTMLDivElement>(null);

  // Voice dictation: speak → the browser transcribes into the message box. No
  // audio is uploaded or stored — the operator reviews the text and sends it as
  // a normal message. Uses the built-in Web Speech API (hidden if unsupported).
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const dictationBaseRef = useRef("");
  const speechSupported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const toggleDictation = () => {
    if (!speechSupported) return;
    if (listening) {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = navigator.language || "en-GB"; // follows the tablet's language
    rec.continuous = true;
    rec.interimResults = true;
    dictationBaseRef.current = text.trim() ? text.trim() + " " : "";
    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setText(dictationBaseRef.current + transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  };

  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* ignore */ } }, []);

  // Voice note: record audio and SEND it (distinct from dictation above, which
  // only fills the text box). Stored in the private dm-audio bucket; played via a
  // short-lived signed URL.
  const [recording, setRecording] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const cancelSendRef = useRef(false);
  const recordRecognitionRef = useRef<any>(null);
  const recordTranscriptRef = useRef("");
  const audioSupported =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const stopStream = () => { audioStreamRef.current?.getTracks().forEach((t) => t.stop()); audioStreamRef.current = null; };
  const stopRecordTranscription = () => { try { recordRecognitionRef.current?.stop(); } catch { /* ignore */ } recordRecognitionRef.current = null; };

  const uploadAndSendAudio = async (blob: Blob) => {
    if (!activeId || !user) return;
    setUploadingAudio(true);
    try {
      const ext = (blob.type.includes("mp4") || blob.type.includes("mpeg")) ? "mp4" : "webm";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("dm-audio").upload(path, blob, { contentType: blob.type || "audio/webm" });
      if (upErr) throw upErr;
      // Send the transcribed speech as the message text (audio player still shows);
      // fall back to a label if transcription is unsupported or empty.
      const spoken = recordTranscriptRef.current.trim();
      await sendMsg.mutateAsync({ recipientId: activeId, message: spoken || "🎤 Voice message", audioUrl: path });
    } catch (e: any) {
      const msg = e?.message || "Failed to send voice message";
      toast.error(msg);
      logSystemError("RLS_ERROR", `Voice note send failed: ${msg}`, { metadata: { recipientId: activeId } });
    } finally {
      setUploadingAudio(false);
    }
  };

  const startRecording = async () => {
    if (!activeId || !audioSupported) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];
      cancelSendRef.current = false;
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stopStream();
        if (cancelSendRef.current) return;
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size > 0) await uploadAndSendAudio(blob);
      };
      mediaRecorderRef.current = mr;
      mr.start();

      // Transcribe the speech in parallel (best-effort) so the voice note also
      // carries the text of what was said.
      recordTranscriptRef.current = "";
      if (speechSupported) {
        try {
          const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          const rec = new SR();
          rec.lang = navigator.language || "en-GB";
          rec.continuous = true;
          rec.interimResults = true;
          rec.onresult = (e: any) => {
            let t = "";
            for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
            recordTranscriptRef.current = t;
          };
          recordRecognitionRef.current = rec;
          rec.start();
        } catch { /* transcription is best-effort */ }
      }

      setRecording(true);
    } catch {
      stopStream();
      toast.error("Microphone permission is needed to record a voice message.");
    }
  };

  const stopAndSend = () => { cancelSendRef.current = false; stopRecordTranscription(); try { mediaRecorderRef.current?.stop(); } catch { /* ignore */ } setRecording(false); };
  const cancelRecording = () => { cancelSendRef.current = true; recordTranscriptRef.current = ""; stopRecordTranscription(); try { mediaRecorderRef.current?.stop(); } catch { /* ignore */ } stopStream(); setRecording(false); };

  useEffect(() => () => { stopStream(); stopRecordTranscription(); }, []);

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
    const list = !q
      ? partners
      : partners.filter(
          (p) => p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q),
        );
    // Conversations with unread messages float to the top so you see who wrote.
    return [...list].sort(
      (a, b) => ((unreadBySender[b.user_id] ?? 0) > 0 ? 1 : 0) - ((unreadBySender[a.user_id] ?? 0) > 0 ? 1 : 0),
    );
  }, [partners, filter, unreadBySender]);

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
      <div className="space-y-4">
        <PageHeader
          title={title}
          description="Direct messages between people in the system."
          icon={<MessageCircle className="h-5 w-5" />}
        />

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
                    filtered.map((p) => {
                      const unread = unreadBySender[p.user_id] ?? 0;
                      return (
                      <button
                        key={p.user_id}
                        onClick={() => setActiveId(p.user_id)}
                        className={cn(
                          "w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent",
                          activeId === p.user_id && "bg-accent",
                        )}
                      >
                        <div className="relative h-9 w-9 shrink-0">
                          <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold">
                            {initials(p.name)}
                          </div>
                          {unread > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={cn("text-sm truncate", unread > 0 ? "font-bold text-foreground" : "font-medium")}>{p.name}</p>
                          {p.line_labels && (
                            <p className="text-2xs text-muted-foreground truncate">
                              {p.line_labels}
                            </p>
                          )}
                        </div>
                        {unread > 0 && (
                          <span className="ml-1 shrink-0 rounded-full bg-primary px-2 py-0.5 text-2xs font-semibold text-primary-foreground">
                            {unread}
                          </span>
                        )}
                      </button>
                      );
                    })
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
                        No messages yet.
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
                                  <p className="text-2xs font-semibold opacity-70 mb-0.5">
                                    {m.sender_name}
                                  </p>
                                )}
                                <p className="whitespace-pre-wrap">{m.message}</p>
                                {m.audio_url && <VoiceNote path={m.audio_url} />}
                                {m.audio_url && transcriptions[m.id]?.text && (
                                  <p className="whitespace-pre-wrap mt-1 pt-1 border-t border-current/20 italic opacity-90 text-sm">
                                    {transcriptions[m.id]!.text}
                                  </p>
                                )}
                                {(() => {
                                  const t = translations[m.id];
                                  if (t?.show && t.text) {
                                    return (
                                      <p className="whitespace-pre-wrap mt-1 pt-1 border-t border-current/20 italic opacity-90">
                                        {t.text}
                                      </p>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-2xs text-muted-foreground">
                                  {format(new Date(m.created_at), "dd/MM HH:mm")}
                                  {isOwn && m.read_at && " · Read"}
                                </span>
                                {(() => {
                                  const t = translations[m.id];
                                  if (t?.loading) {
                                    return (
                                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                    );
                                  }
                                  if (t?.error) {
                                    return (
                                      <button
                                        onClick={() => handleTranslate(m.id, m.message)}
                                        className="text-2xs text-destructive-strong hover:underline"
                                      >
                                        Translation failed · Retry
                                      </button>
                                    );
                                  }
                                  const label = t?.text
                                    ? t.show
                                      ? "Show original"
                                      : "Show translation"
                                    : "Translate";
                                  return (
                                    <button
                                      onClick={() => handleTranslate(m.id, m.message)}
                                      className="text-2xs text-muted-foreground hover:text-foreground hover:underline"
                                    >
                                      {label}
                                    </button>
                                  );
                                })()}
                                {m.audio_url && (() => {
                                  const tr = transcriptions[m.id];
                                  if (tr?.loading) return <span className="flex items-center gap-1 text-2xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Converting…</span>;
                                  if (tr?.error) return <button onClick={() => handleTranscribe(m.id, m.audio_url!)} title={tr.error} className="text-2xs text-destructive-strong hover:underline max-w-[220px] truncate">Failed: {tr.error} · Retry</button>;
                                  if (tr?.text) return null;
                                  return <button onClick={() => handleTranscribe(m.id, m.audio_url!)} className="text-2xs text-muted-foreground hover:text-foreground hover:underline">Convert to text</button>;
                                })()}
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
                      className="flex-1 h-12"
                    />
                    {recording ? (
                      <>
                        <div className="flex items-center px-2 text-xs font-medium text-destructive-strong whitespace-nowrap">
                          <span className="animate-pulse">● Rec</span>
                        </div>
                        <Button size="icon" variant="ghost" className="h-12 w-12 touch-manipulation" onClick={cancelRecording} disabled={uploadingAudio} title="Cancel" aria-label="Cancel recording">
                          <X className="h-5 w-5" />
                        </Button>
                        <Button size="icon" variant="destructive" className="h-12 w-12 touch-manipulation" onClick={stopAndSend} disabled={uploadingAudio} title="Stop & send voice message" aria-label="Stop and send voice message">
                          {uploadingAudio ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                        </Button>
                      </>
                    ) : (
                      <>
                        {speechSupported && (
                          <Button
                            size="icon"
                            variant={listening ? "destructive" : "outline"}
                            className="h-12 w-12 touch-manipulation"
                            onClick={toggleDictation}
                            title={listening ? "Stop dictation" : "Dictate to text"}
                            aria-label={listening ? "Stop dictation" : "Dictate to text"}
                          >
                            <Captions className={cn("h-5 w-5", listening && "animate-pulse")} />
                          </Button>
                        )}
                        {audioSupported && (
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-12 w-12 touch-manipulation"
                            onClick={startRecording}
                            disabled={!activeId || uploadingAudio}
                            title="Record voice message"
                            aria-label="Record voice message"
                          >
                            {uploadingAudio ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
                          </Button>
                        )}
                        <Button
                          size="icon"
                          className="h-12 w-12 touch-manipulation"
                          aria-label="Send message"
                          onClick={handleSend}
                          disabled={!text.trim() || sendMsg.isPending}
                        >
                          {sendMsg.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                      </>
                    )}
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
