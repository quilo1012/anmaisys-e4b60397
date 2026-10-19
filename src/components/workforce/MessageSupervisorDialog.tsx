import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCheck, Loader2, MessageSquare, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDMThread, useDMUnreadBySender, useMarkDMRead, useMySupervisor } from "@/hooks/useDirectMessages";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { windowLabel, type OvertimeRequest } from "@/lib/overtimeRequests";

/**
 * A word to the supervisor, in the app's chat.
 *
 * Since a yes books the shift (BLOCO 102) it cannot be taken back from the phone;
 * running late, or not coming after all, is said to the supervisor. Who that is, is
 * the database's answer, never the screen's: the supervisor on file
 * (`employees.manager_id`, BLOCO 107), or — about an ask, when nobody is on file —
 * whoever posted it. With an ask the message goes through `message_overtime_supervisor`,
 * which checks the ask was put to this person; without one, through
 * `message_my_supervisor`, which only ever writes to the supervisor on file. The chat's
 * own routing lets only operators and staff write directly. The supervisor reads and
 * answers in Messages, and the answer shows here, because both sides read the same
 * `direct_messages` thread.
 */
/** "14:05" today, "Mon 19/10 14:05" before that. */
function sentAt(iso: string, now = new Date()) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(",", "");
  return `${day} ${time}`;
}

export function MessageSupervisorDialog({ request, fmtDate, defaultOpen = false, label = "Message supervisor" }: {
  /** The ask it is about, or none: a conversation with the supervisor on file. */
  request?: Pick<OvertimeRequest, "id" | "on_date" | "starts_at" | "ends_at" | "created_by"> | null;
  fmtDate?: (iso: string) => string;
  /** Opened on arrival — the bell's and the toast's link (`?chat=supervisor`). */
  defaultOpen?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: mine } = useMySupervisor();
  const supervisor = mine?.supervisor ?? null;
  // The same person the database will write to: on file first, then the ask's poster.
  const partner = supervisor?.user_id ?? request?.created_by ?? null;
  const thread = useDMThread(open ? partner : null);
  // The supervisor's reply has to be findable without opening every booked shift: the
  // button says how many are unread, and opening the thread reads them.
  const { data: unreadBy = {} } = useDMUnreadBySender();
  const unread = partner ? unreadBy[partner] ?? 0 : 0;
  const markRead = useMarkDMRead(partner);
  const { mutate: markThreadRead } = markRead;
  const lastId = thread.data?.at(-1)?.id;
  useEffect(() => {
    if (open && unread > 0) markThreadRead();
  }, [open, unread, lastId, markThreadRead]);

  const send = useMutation({
    mutationFn: async (message: string) => {
      // BLOCOS 102 and 107: the types.ts only learns them once they are pasted. A
      // retry of the same words within two minutes returns the message already
      // written, so a tap that timed out and is tapped again is still one message.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)(
        request ? "message_overtime_supervisor" : "message_my_supervisor",
        request ? { p_request_id: request.id, p_message: message } : { p_message: message },
      );
      if (error) {
        if ((error as { code?: string }).code === "PGRST202") {
          throw new Error("Messaging the supervisor is being set up. Please tell them in person for now.");
        }
        throw error;
      }
    },
    onSuccess: () => {
      setText("");
      toast.success("Message sent to your supervisor");
      void qc.invalidateQueries({ queryKey: ["dm_thread", user?.id, partner] });
    },
    onError: (e) => toast.error((e as Error).message || "Could not send the message", {
      description: "Nothing was sent. Check your signal and try again.",
    }),
  });

  const messages = (thread.data ?? []).slice(-20);
  const body = text.trim();
  // Nobody to write to: no ask to fall back on and nobody on file. Said, not hidden.
  const nobody = !request && !supervisor;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="h-11 w-full">
          <MessageSquare className="mr-2 h-4 w-4" /> {label}
          {unread > 0 && (
            <span
              className="ml-2 rounded-full bg-destructive px-2 py-0.5 text-xs font-bold tabular-nums text-destructive-foreground"
              aria-label={`${unread} unread ${unread === 1 ? "reply" : "replies"}`}
            >
              {unread}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{supervisor ? `Message ${supervisor.full_name}` : "Message your supervisor"}</DialogTitle>
          <DialogDescription>
            {request && fmtDate
              ? <>About {fmtDate(request.on_date)}, {windowLabel(request.starts_at, request.ends_at)}. </>
              : null}
            They get an alert and can reply here.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-2" aria-live="polite">
          {thread.isLoading ? (
            <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          ) : messages.map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-lg px-3 py-1.5 text-sm",
                  mine ? "bg-primary text-primary-foreground" : "bg-card border",
                )}>
                  {!mine && <div className="text-xs font-medium text-muted-foreground">{m.sender_name}</div>}
                  <div className="whitespace-pre-wrap break-words">{m.message}</div>
                  {/* When, and — on your own messages — whether it has been read. */}
                  <div className={cn(
                    "mt-0.5 flex items-center justify-end gap-1 text-[10px] tabular-nums",
                    mine ? "text-primary-foreground/75" : "text-muted-foreground",
                  )}>
                    <time dateTime={m.created_at}>{sentAt(m.created_at)}</time>
                    {mine && (m.read_at
                      ? <CheckCheck className="h-3 w-3" aria-label="Seen" />
                      : <Check className="h-3 w-3" aria-label="Sent" />)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {nobody && (
          <p className="rounded-md border border-dashed p-2 text-sm text-muted-foreground" role="status">
            No supervisor is on file for you yet. Ask the office to set your manager on your record.
          </p>
        )}
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. I'll be 10 minutes late"
            maxLength={1000}
            rows={3}
            aria-label="Message"
          />
          <Button className="h-11 w-full" disabled={!body || send.isPending || nobody} onClick={() => send.mutate(body)}>
            {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
