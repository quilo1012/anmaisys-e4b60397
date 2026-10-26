/**
 * Which bell row a tapped phone notification was.
 *
 * The worker hands the page the notification's tag (sw.js, `notification=` in the
 * address). Three tags reach it today:
 *  - the database's `notification_push` trigger (BLOCO 117): `<kind>:<notification id>`;
 *  - the overtime ask the office posts from the app: `overtime-ask-<request id>`, whose
 *    bell row is the `overtime_new` row for that ask (BLOCO 100);
 *  - the same trigger, for the notices about one ask after it was posted (BLOCO 132):
 *    `overtime-notice-<request id>`. One tag per ask, so on the phone a cancellation
 *    replaces the reminder it makes wrong instead of sitting under it. Every unread
 *    notice of those kinds for that ask is marked: the one on screen stands for them all.
 * Any other tag (a chat line, a test push) has no bell row to mark, and is ignored.
 */
export const OPENED_PARAM = "notification";

export type OpenedNotification =
  | { by: "id"; id: string }
  | { by: "ask"; requestId: string }
  | { by: "notice"; requestId: string };

/**
 * The kinds that travel under `overtime-notice-<request id>`. Must match the list in
 * `notification_push` (BLOCO 132): a kind here and not there is never tagged so; a kind
 * there and not here is tagged so and never marked read from the phone.
 */
export const OVERTIME_NOTICE_KINDS = [
  "overtime_changed",
  "overtime_cancelled",
  "overtime_reminder_24h",
  "overtime_reminder_2h",
] as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FROM_TRIGGER = new RegExp(`^[a-z_]+:(${UUID})$`, "i");
const FROM_ASK = new RegExp(`^overtime-ask-(${UUID})$`, "i");
const FROM_NOTICE = new RegExp(`^overtime-notice-(${UUID})$`, "i");

export function openedNotificationFromTag(tag: string | null | undefined): OpenedNotification | null {
  if (!tag) return null;
  const t = FROM_TRIGGER.exec(tag);
  if (t) return { by: "id", id: t[1].toLowerCase() };
  const a = FROM_ASK.exec(tag);
  if (a) return { by: "ask", requestId: a[1].toLowerCase() };
  const n = FROM_NOTICE.exec(tag);
  if (n) return { by: "notice", requestId: n[1].toLowerCase() };
  return null;
}
