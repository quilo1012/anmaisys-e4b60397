import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { nextMeetingLabel, safeVideoLink, type MyMeeting } from "@/lib/meetings";
import { useUpcomingMeetings } from "@/hooks/useMeetings";

/**
 * My next meeting, today or tomorrow, at the top of Meetings. Quiet until 15 minutes
 * before the start; from then until it ends it fills with the primary colour and Join
 * becomes the button to press. Draws nothing when the next one is further away.
 */
export function NextMeetingBanner({ onOpen }: { onOpen: (m: MyMeeting) => void }) {
  const q = useUpcomingMeetings(20);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const next = (q.data ?? []).find((m) => !m.cancelled_at && new Date(m.ends_at).getTime() > now.getTime());
  const label = next ? nextMeetingLabel(next, now) : null;
  if (!next || !label) return null;
  const link = safeVideoLink(next.video_link);

  return (
    <section
      aria-label="Your next meeting"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors motion-reduce:transition-none",
        label.soon ? "border-primary bg-primary text-primary-foreground" : "bg-card",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(next)}
        className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className={cn("block text-sm tabular-nums", label.soon ? "font-semibold" : "text-muted-foreground")}>{label.text}</span>
        <span className="block truncate text-base font-semibold">{next.title}</span>
        {next.location && <span className={cn("block truncate text-xs", label.soon ? "opacity-90" : "text-muted-foreground")}>{next.location}</span>}
      </button>
      {link && (
        <Button asChild size={label.soon ? "default" : "sm"} variant={label.soon ? "secondary" : "outline"}>
          <a href={link} target="_blank" rel="noopener noreferrer"><Video className="mr-2 h-4 w-4" />Join</a>
        </Button>
      )}
    </section>
  );
}
