import { useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { waitingForMyAnswer, whenLabel, type MyMeeting } from "@/lib/meetings";
import { useMeetingActions, useUpcomingMeetings } from "@/hooks/useMeetings";
import { DeclineDialog } from "@/components/meetings/DeclineDialog";
import { answeredToast } from "@/lib/meetingToasts";

/**
 * "Waiting for your answer", above the calendar: the coming meetings I have not answered,
 * with Accept and Decline on the row. Draws nothing when there are none, so it costs no
 * row on a line tablet that has nothing to answer.
 */
export function MeetingsToAnswer({ onOpen }: { onOpen: (m: MyMeeting) => void }) {
  const q = useUpcomingMeetings(20);
  const { respond } = useMeetingActions();
  const [declining, setDeclining] = useState<MyMeeting | null>(null);
  const list = waitingForMyAnswer(q.data ?? []);
  if (list.length === 0) return null;

  const answer = (m: MyMeeting, response: "accepted" | "declined", reason?: string) =>
    respond.mutate({ id: m.id, response, reason }, {
      onSuccess: (r) => { setDeclining(null); answeredToast(response, r); },
      onError: (e) => toast.error((e as { message?: string })?.message ?? "Something went wrong"),
    });

  return (
    <section aria-labelledby="meetings-to-answer" className="rounded-xl border border-primary/40 bg-primary/5 p-3">
      <h2 id="meetings-to-answer" className="mb-1 text-sm font-semibold">Waiting for your answer ({list.length})</h2>
      <ul className="divide-y">
        {list.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <button type="button" onClick={() => onOpen(m)} className="min-w-[12rem] flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="block truncate text-sm font-medium">{m.title}</span>
              <span className="block truncate text-xs tabular-nums text-muted-foreground">{whenLabel(m)}{m.location ? ` · ${m.location}` : ""}</span>
            </button>
            <div className="flex gap-2">
              <Button size="sm" disabled={respond.isPending} onClick={() => answer(m, "accepted")} aria-label={`Accept ${m.title}`}>
                <Check className="mr-1 h-4 w-4" />Accept
              </Button>
              <Button size="sm" variant="outline" disabled={respond.isPending} onClick={() => setDeclining(m)} aria-label={`Decline ${m.title}`}>
                <X className="mr-1 h-4 w-4" />Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <DeclineDialog open={!!declining} title={declining?.title ?? ""} pending={respond.isPending}
        onCancel={() => setDeclining(null)} onDecline={(reason) => declining && answer(declining, "declined", reason)} />
    </section>
  );
}
