import { forwardRef } from "react";
import { toast } from "sonner";
import { CheckCircle2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { audienceLabel, isRead, whenLabel, type MyAnnouncement } from "@/lib/announcements";
import { useAcknowledgeAnnouncement } from "@/hooks/useAnnouncements";

const errText = (e: unknown) => (e as { message?: string })?.message ?? "Could not record it. Try again.";

interface Props {
  announcement: MyAnnouncement;
  /** Drawn with a ring: the one a bell row or link pointed at. */
  highlighted?: boolean;
  className?: string;
}

/**
 * One announcement, as the employee reads it on their phone: what it says, when it was
 * published and who it was for, and the one button that records they have read it. Once
 * pressed, the button gives way to the time it was confirmed — it cannot be pressed twice,
 * and the database would keep the first time if it were.
 */
export const AnnouncementCard = forwardRef<HTMLElement, Props>(function AnnouncementCard({ announcement: a, highlighted, className }, ref) {
  const ack = useAcknowledgeAnnouncement();
  const read = isRead(a);
  const confirm = () =>
    ack.mutate(a.id, {
      onSuccess: () => toast.success("Thank you — recorded as read"),
      onError: (e) => toast.error(errText(e)),
    });

  return (
    <article
      ref={ref}
      aria-labelledby={`ann-${a.id}-title`}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm",
        !read && "border-primary/40",
        highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        className,
      )}
    >
      {!read && <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-primary" />}
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Megaphone className="h-4 w-4" aria-hidden />
        <span>Company announcement</span>
        <span className="ml-auto flex items-center gap-1.5">
          {a.urgent && <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-destructive-foreground">Urgent</span>}
          {read
            ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-muted-foreground">Read</span>
            : <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-primary-foreground">New</span>}
        </span>
      </div>

      <h3 id={`ann-${a.id}-title`} className="text-lg font-semibold leading-snug">{a.title}</h3>
      <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{a.body}</p>

      <p className="mt-3 text-xs text-muted-foreground">
        Published {whenLabel(a.published_at)} · {audienceLabel(a.audience_department, a.audience_shift_group)}
      </p>

      {a.requires_ack && (
        read ? (
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            You confirmed you read this on {whenLabel(a.acknowledged_at)}
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-muted-foreground">Please acknowledge that you have read this announcement.</p>
            <Button className="h-12 w-full text-sm font-semibold tracking-wide" onClick={confirm} disabled={ack.isPending}>
              {ack.isPending ? "Recording…" : "I HAVE READ THIS ANNOUNCEMENT"}
            </Button>
          </div>
        )
      )}
    </article>
  );
});
