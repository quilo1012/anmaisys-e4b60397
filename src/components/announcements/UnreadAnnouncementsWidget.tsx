import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { isRead } from "@/lib/announcements";
import { useMyAnnouncements } from "@/hooks/useAnnouncements";
import { AnnouncementCard } from "./AnnouncementCard";

/**
 * On each person's Overview: the announcements they have not confirmed yet, in full, with
 * the button — so opening the app is enough to see and acknowledge them. Draws nothing
 * while loading, when everything is read, or before BLOCO 164 exists.
 */
export function UnreadAnnouncementsWidget({ className, limit = 3 }: { className?: string; limit?: number }) {
  const q = useMyAnnouncements();
  const unread = (q.data ?? []).filter((a) => !isRead(a));
  if (unread.length === 0) return null;
  const shown = unread.slice(0, limit);
  return (
    <section aria-label="New announcements" className={cn("space-y-3", className)}>
      {shown.map((a) => <AnnouncementCard key={a.id} announcement={a} />)}
      {unread.length > shown.length && (
        <Link to="/dashboard/updates" className="block text-center text-sm font-medium text-primary hover:underline">
          {unread.length - shown.length} more unread — see all announcements
        </Link>
      )}
    </section>
  );
}
