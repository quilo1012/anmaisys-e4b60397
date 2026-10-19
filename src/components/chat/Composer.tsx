import { useEffect, useRef, useState } from "react";
import { Captions, FileText, Loader2, Mic, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CHAT_BODY_MAX, CHAT_FILE_TYPES, CHAT_FILES_PER_MESSAGE, fileProblem, formatBytes } from "@/lib/chat";
import { cn } from "@/lib/utils";

const ACCEPT = Object.keys(CHAT_FILE_TYPES).join(",") + ",.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.pdf";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;

/**
 * Where a message is written. Enter sends, Shift+Enter is a new line. Files are
 * checked here (type, size, how many) so a person hears why before anything uploads;
 * the bucket checks them again.
 */
export function Composer({
  onSend, onVoice, disabled, disabledReason, replyTo, onCancelReply, placeholder, resetKey,
}: {
  onSend: (text: string, files: File[]) => void;
  /** Voice notes (private conversations only). */
  onVoice?: (blob: Blob, transcript: string) => Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
  replyTo?: { name: string; body: string } | null;
  onCancelReply?: () => void;
  placeholder: string;
  /** Changes with the conversation, so a draft does not follow you to another one. */
  resetKey: string;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setText(""); setFiles([]); }, [resetKey]);
  useEffect(() => { if (replyTo) area.current?.focus(); }, [replyTo]);

  // Grows with the text, up to six lines.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const problem = fileProblem(f);
      if (problem) { toast.error(problem); continue; }
      if (next.length >= CHAT_FILES_PER_MESSAGE) { toast.error(`Up to ${CHAT_FILES_PER_MESSAGE} files per message`); break; }
      next.push(f);
    }
    setFiles(next);
  };

  const send = () => {
    const t = text.trim();
    if ((!t && files.length === 0) || disabled) return;
    if (t.length > CHAT_BODY_MAX) { toast.error(`Keep it under ${CHAT_BODY_MAX} characters`); return; }
    onSend(t, files);
    setText("");
    setFiles([]);
    area.current?.focus();
  };

  // Dictation: the browser writes what is said into the box. Nothing is uploaded.
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  const base = useRef("");
  const toggleDictation = () => {
    if (!SR) return;
    if (listening) { try { rec.current?.stop(); } catch { /* ignore */ } return; }
    const r = new SR();
    r.lang = navigator.language || "en-GB";
    r.continuous = true;
    r.interimResults = true;
    base.current = text.trim() ? text.trim() + " " : "";
    r.onresult = (e: any) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setText(base.current + t);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  };

  // Voice note: recorded, uploaded and sent; the spoken words ride along as the text.
  const [recording, setRecording] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const cancel = useRef(false);
  const voiceRec = useRef<any>(null);
  const spoken = useRef("");
  const canRecord = !!onVoice && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  const stopStream = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => () => { stopStream(); try { rec.current?.stop(); voiceRec.current?.stop(); } catch { /* ignore */ } }, []);

  const startRecording = async () => {
    if (!onVoice) return;
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      cancel.current = false;
      const m = new MediaRecorder(stream.current);
      m.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      m.onstop = async () => {
        stopStream();
        if (cancel.current) return;
        const blob = new Blob(chunks.current, { type: m.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        setUploadingVoice(true);
        try { await onVoice(blob, spoken.current.trim()); } finally { setUploadingVoice(false); }
      };
      mr.current = m;
      m.start();
      spoken.current = "";
      if (SR) {
        try {
          const r = new SR();
          r.lang = navigator.language || "en-GB";
          r.continuous = true;
          r.interimResults = true;
          r.onresult = (e: any) => {
            let t = "";
            for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
            spoken.current = t;
          };
          voiceRec.current = r;
          r.start();
        } catch { /* best effort */ }
      }
      setRecording(true);
    } catch {
      stopStream();
      toast.error("Microphone permission is needed to record a voice message.");
    }
  };
  const stopRecording = (send: boolean) => {
    cancel.current = !send;
    try { voiceRec.current?.stop(); } catch { /* ignore */ }
    try { mr.current?.stop(); } catch { /* ignore */ }
    if (!send) stopStream();
    setRecording(false);
  };

  if (disabled && disabledReason) {
    return <div className="border-t px-4 py-3 text-center text-xs text-muted-foreground">{disabledReason}</div>;
  }

  return (
    <div className="border-t bg-card p-2 sm:p-3">
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-primary bg-muted/60 px-2 py-1.5 text-xs">
          <div className="min-w-0 flex-1">
            <span className="font-semibold">Replying to {replyTo.name}</span>
            <p className="truncate text-muted-foreground">{replyTo.body || "📎 File"}</p>
          </div>
          <button type="button" onClick={onCancelReply} className="rounded p-0.5 hover:bg-muted" aria-label="Cancel reply"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Files to send">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex max-w-[240px] items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs">
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
              <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded p-0.5 hover:bg-muted" aria-label={`Remove ${f.name}`}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {recording ? (
        <div className="flex items-center gap-2">
          <span className="flex flex-1 items-center gap-2 px-2 text-sm font-medium text-destructive-strong"><span className="h-2 w-2 animate-pulse rounded-full bg-destructive" /> Recording…</span>
          <Button size="icon" variant="ghost" className="h-11 w-11" onClick={() => stopRecording(false)} aria-label="Cancel recording"><X className="h-5 w-5" /></Button>
          <Button size="icon" variant="destructive" className="h-11 w-11" onClick={() => stopRecording(true)} aria-label="Stop and send voice message"><Send className="h-5 w-5" /></Button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0" onClick={() => fileInput.current?.click()} disabled={disabled} aria-label="Attach files" title="Attach files (images, PDF, Office, text — 10 MB each)">
            <Paperclip className="h-5 w-5" />
          </Button>
          <Textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
              if (e.key === "Escape" && replyTo) onCancelReply?.();
            }}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            placeholder={placeholder}
            aria-label="Message"
            rows={1}
            maxLength={CHAT_BODY_MAX}
            disabled={disabled}
            className="min-h-[44px] flex-1 resize-none py-2.5"
          />
          {SR && (
            <Button size="icon" variant={listening ? "destructive" : "ghost"} className="h-11 w-11 shrink-0" onClick={toggleDictation} disabled={disabled}
              aria-label={listening ? "Stop dictation" : "Dictate to text"} title={listening ? "Stop dictation" : "Dictate to text"}>
              <Captions className={cn("h-5 w-5", listening && "animate-pulse")} />
            </Button>
          )}
          {canRecord && !text.trim() && files.length === 0 ? (
            <Button size="icon" variant="ghost" className="h-11 w-11 shrink-0" onClick={startRecording} disabled={disabled || uploadingVoice} aria-label="Record voice message" title="Record voice message">
              {uploadingVoice ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
            </Button>
          ) : (
            <Button size="icon" className="h-11 w-11 shrink-0" onClick={send} disabled={disabled || (!text.trim() && files.length === 0)} aria-label="Send message">
              <Send className="h-5 w-5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
