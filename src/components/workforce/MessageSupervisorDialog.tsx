import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDMThread } from "@/hooks/useDirectMessages";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { windowLabel, type OvertimeRequest } from "@/lib/overtimeRequests";

/**
 * A word to whoever posted the ask, in the app's chat.
 *
 * Since a yes books the shift (BLOCO 102) it cannot be taken back from the phone;
 * running late, or not coming after all, is said to the supervisor. The message goes
 * through `message_overtime_supervisor`, which checks it is about an ask this person
 * can see and sends it to whoever posted it — the chat's own routing lets only
 * operators and staff write. The supervisor reads and answers it in Messages, and the
 * answer shows here, because both sides read the same `direct_messages` thread.
 */
export function MessageSupervisorDialog({ request, fmtDate }: {
  request: Pick<OvertimeRequest, "id" | "on_date" | "starts_at" | "ends_at" | "created_by">;
  fmtDate: (iso: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { user } = useAuth();
  const qc = useQueryClient();
  const thread = useDMThread(open ? request.created_by : null);

  const send = useMutation({
    mutationFn: async (message: string) => {
      // BLOCO 102: the types.ts only learns the function once the block is pasted.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("message_overtime_supervisor", {
        p_request_id: request.id, p_message: message,
      });
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
      void qc.invalidateQueries({ queryKey: ["dm_thread", user?.id, request.created_by] });
    },
    onError: (e) => toast.error((e as Error).message || "Could not send the message", {
      description: "Nothing was sent. Check your signal and try again.",
    }),
  });

  const messages = (thread.data ?? []).slice(-20);
  const body = text.trim();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="lg" className="h-11 w-full">
          <MessageSquare className="mr-2 h-4 w-4" /> Message supervisor
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Message your supervisor</DialogTitle>
          <DialogDescription>
            About {fmtDate(request.on_date)}, {windowLabel(request.starts_at, request.ends_at)}. They get an alert
            and can reply here.
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
                </div>
              </div>
            );
          })}
        </div>
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. I'll be 10 minutes late"
            maxLength={1000}
            rows={3}
            aria-label="Message"
          />
          <Button className="h-11 w-full" disabled={!body || send.isPending} onClick={() => send.mutate(body)}>
            {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
