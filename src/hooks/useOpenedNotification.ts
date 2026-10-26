import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OPENED_PARAM, OVERTIME_NOTICE_KINDS, openedNotificationFromTag, type OpenedNotification } from "@/lib/notificationOpen";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Tags already marked in this page's life: the address and the worker's message can both bring the same one. */
const handled = new Set<string>();

/**
 * Marks the bell row read. `read_at is null` makes it idempotent: a second tap, the
 * address and the message arriving together, or the bell marking it at the same moment
 * all end in one `read_at`, and none of them overwrites the first.
 */
export async function markOpenedNotification(userId: string, opened: OpenedNotification): Promise<void> {
  let q = db.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("user_id", userId).is("read_at", null);
  if (opened.by === "id") q = q.eq("id", opened.id);
  else if (opened.by === "ask") q = q.eq("kind", "overtime_new").eq("overtime_request_id", opened.requestId);
  else q = q.in("kind", [...OVERTIME_NOTICE_KINDS]).eq("overtime_request_id", opened.requestId);
  const { error } = await q;
  if (error) throw error;
}

/**
 * Opening a phone notification marks its bell row read, so the bell, the Home Screen
 * badge (NotificationPanel) and the phone agree. Opening it does nothing else: it is
 * never an answer to an overtime ask, and the screen it opens reads the record afresh.
 */
export function useOpenedNotification(userId: string | null | undefined) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const mark = (tag: string | null) => {
      const opened = openedNotificationFromTag(tag);
      if (!tag || !opened || handled.has(tag)) return;
      handled.add(tag);
      markOpenedNotification(userId, opened)
        .then(() => qc.invalidateQueries({ queryKey: ["my_notifications", userId] }))
        // Not marked is not lost: the bell still shows it unread, and opening it there marks it.
        .catch((e) => { handled.delete(tag); console.warn("marking an opened notification failed", e); });
    };

    const params = new URLSearchParams(location.search);
    const tag = params.get(OPENED_PARAM);
    if (tag !== null) {
      mark(tag);
      // Out of the address, so a reload or a shared link does not carry it.
      params.delete(OPENED_PARAM);
      const search = params.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash }, { replace: true });
    }

    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !navigator.serviceWorker) return;
    const onMessage = (ev: MessageEvent) => { if (ev.data?.type === "notification-opened") mark(ev.data.tag ?? null); };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [userId, location.search, location.pathname, location.hash, navigate, qc]);
}
