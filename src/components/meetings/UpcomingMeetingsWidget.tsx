import { Link } from "react-router-dom";
import { CalendarDays, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_CLASS, safeVideoLink, toneOf, whenLabel } from "@/lib/meetings";
import { useUpcomingMeetings } from "@/hooks/useMeetings";

/**
 * "Upcoming meetings" on each person's Overview: the next three they have not declined.
 * Draws nothing while loading, when there are none, or before BLOCO 159 exists — an empty
 * card on a line tablet costs a row of a 490px screen and says nothing.
 */
export function UpcomingMeetingsWidget({ className }: { className?: string }) {
  const q = useUpcomingMeetings(3);
  const list = q.data ?? [];
  if (list.length === 0) return null;
  return (
    <section aria-label="Upcoming meetings" className={cn("rounded-xl border bg-card p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4" />Upcoming meetings</h2>
        <Link to="/dashboard/communication/meetings" className="text-xs font-medium text-primary hover:underline">Calendar</Link>
      </div>
      <ul className="divide-y">
        {list.map((m) => {
          const link = safeVideoLink(m.video_link);
          return (
            <li key={m.id} className="flex items-center gap-2 py-1.5">
              <span className={cn("h-8 w-1.5 shrink-0 rounded-full border", TONE_CLASS[toneOf(m)])} aria-hidden />
              <Link to={`/dashboard/communication/meetings?meeting=${m.id}`} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.title}</span>
                <span className="block truncate text-xs tabular-nums text-muted-foreground">
                  {whenLabel(m)}{m.location ? ` · ${m.location}` : ""}{m.my_response === "pending" ? " · not answered" : ""}
                </span>
              </Link>
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent">
                  <Video className="h-3.5 w-3.5" />Join
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
