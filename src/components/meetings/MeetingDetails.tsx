import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Check, MapPin, Pencil, Repeat, Video, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { TONE_LABEL, answerSummary, safeVideoLink, toneOf, whenLabel, type MyMeeting, type Scope } from "@/lib/meetings";
import { useMeetingActions, useMeetingParticipants } from "@/hooks/useMeetings";
import { DeclineDialog } from "@/components/meetings/DeclineDialog";
import { answeredToast } from "@/lib/meetingToasts";

const errText = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong";

const RESPONSE_DOT: Record<string, string> = {
  accepted: "bg-primary", pending: "bg-muted-foreground/40", declined: "bg-destructive",
};

/** Asked before changing or cancelling one meeting of a series. */
export function ScopeDialog({ open, verb, onCancel, onChoose }: {
  open: boolean;
  verb: "Change" | "Cancel";
  onCancel: () => void;
  onChoose: (s: Scope) => void;
}) {
  const [scope, setScope] = useState<Scope>("one");
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{verb} a repeating meeting</AlertDialogTitle>
          <AlertDialogDescription>Which meetings should this apply to?</AlertDialogDescription>
        </AlertDialogHeader>
        <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="gap-3">
          <div className="flex items-center gap-2"><RadioGroupItem id="scope-one" value="one" /><Label htmlFor="scope-one">Only this one</Label></div>
          <div className="flex items-center gap-2"><RadioGroupItem id="scope-following" value="following" /><Label htmlFor="scope-following">This and the following ones</Label></div>
        </RadioGroup>
        <AlertDialogFooter>
          <AlertDialogCancel>Back</AlertDialogCancel>
          <AlertDialogAction onClick={() => onChoose(scope)}>{verb}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function MeetingDetails({ meeting, canManage, myId, onClose, onEdit }: {
  meeting: MyMeeting | null;
  canManage: boolean;
  myId: string | undefined;
  onClose: () => void;
  onEdit: (m: MyMeeting) => void;
}) {
  const participants = useMeetingParticipants(meeting?.id ?? null);
  const { respond, cancel } = useMeetingActions();
  const [asking, setAsking] = useState(false);
  const [confirmOne, setConfirmOne] = useState(false);
  const [declining, setDeclining] = useState(false);

  const m = meeting;
  const tone = m ? toneOf(m) : "pending";
  const link = safeVideoLink(m?.video_link ?? null);
  const isSeries = m ? m.recurrence !== "none" : false;
  const past = m ? new Date(m.ends_at).getTime() < Date.now() : false;
  const invited = m?.my_response != null;

  const answer = (response: "accepted" | "declined", reason?: string) => {
    if (!m) return;
    respond.mutate({ id: m.id, response, reason }, {
      onSuccess: (r) => { setDeclining(false); answeredToast(response, r); },
      onError: (e) => toast.error(errText(e)),
    });
  };
  const doCancel = (scope: Scope) => {
    if (!m) return;
    setAsking(false); setConfirmOne(false);
    cancel.mutate({ id: m.id, scope }, {
      onSuccess: (n) => { toast.success(n > 1 ? `${n} meetings cancelled` : "Meeting cancelled"); onClose(); },
      onError: (e) => toast.error(errText(e)),
    });
  };

  return (
    <Sheet open={!!m} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        {m && (
          <>
            <SheetHeader>
              <SheetTitle className={cn(m.cancelled_at && "line-through text-muted-foreground")}>{m.title}</SheetTitle>
              <SheetDescription>{m.cancelled_at ? "This meeting was cancelled." : invited ? `Your answer: ${TONE_LABEL[tone]}` : "You are not a participant."}</SheetDescription>
            </SheetHeader>

            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-muted-foreground" /><span className="tabular-nums">{whenLabel(m)}</span></p>
              {isSeries && (
                <p className="flex items-center gap-2"><Repeat className="h-4 w-4 text-muted-foreground" />
                  Repeats {m.recurrence}{m.recurrence_until ? ` until ${m.recurrence_until.split("-").reverse().join("/")}` : ""}</p>
              )}
              {m.location && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{m.location}</p>}
              {m.description && <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3">{m.description}</p>}
            </div>

            {link && !m.cancelled_at && (
              <Button asChild className="w-full">
                <a href={link} target="_blank" rel="noopener noreferrer"><Video className="mr-2 h-4 w-4" />Join</a>
              </Button>
            )}

            {invited && !m.cancelled_at && !past && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant={m.my_response === "accepted" ? "default" : "outline"} disabled={respond.isPending} onClick={() => answer("accepted")}>
                  <Check className="mr-1 h-4 w-4" />Accept
                </Button>
                <Button variant={m.my_response === "declined" ? "destructive" : "outline"} disabled={respond.isPending} onClick={() => setDeclining(true)}>
                  <X className="mr-1 h-4 w-4" />Decline
                </Button>
              </div>
            )}

            <section>
              <h3 className="text-sm font-semibold">
                Participants{participants.data ? ` (${participants.data.length})` : ""}
              </h3>
              {participants.data && participants.data.length > 0 && (
                <p className="mb-2 text-xs tabular-nums text-muted-foreground">{answerSummary(participants.data)}</p>
              )}
              {participants.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {participants.error && <p className="text-sm text-destructive">Could not load the participants.</p>}
              <ul className="space-y-1">
                {(participants.data ?? []).map((p) => (
                  <li key={p.user_id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", RESPONSE_DOT[p.response])} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{p.name}{p.user_id === myId ? " (you)" : ""}</span>
                      <span className="text-xs text-muted-foreground">{p.response === "pending" ? "Not answered" : p.response === "accepted" ? "Accepted" : "Declined"}</span>
                    </div>
                    {p.response === "declined" && p.decline_reason && (
                      <p className="ml-4 mt-0.5 whitespace-pre-wrap text-xs italic text-muted-foreground">“{p.decline_reason}”</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {canManage && !m.cancelled_at && (
              <div className="mt-auto grid grid-cols-2 gap-2 border-t pt-4">
                <Button variant="outline" onClick={() => onEdit(m)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                <Button variant="outline" className="text-destructive" disabled={cancel.isPending}
                  onClick={() => (isSeries ? setAsking(true) : setConfirmOne(true))}>Cancel meeting</Button>
              </div>
            )}

            <DeclineDialog open={declining} title={m.title} pending={respond.isPending}
              onCancel={() => setDeclining(false)} onDecline={(reason) => answer("declined", reason)} />
            <ScopeDialog open={asking} verb="Cancel" onCancel={() => setAsking(false)} onChoose={doCancel} />
            <AlertDialog open={confirmOne} onOpenChange={setConfirmOne}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this meeting?</AlertDialogTitle>
                  <AlertDialogDescription>Everybody invited is told it is cancelled.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={() => doCancel("one")}>Cancel meeting</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
