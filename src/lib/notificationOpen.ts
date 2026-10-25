/**
 * Which bell row a tapped phone notification was.
 *
 * The worker hands the page the notification's tag (sw.js, `notification=` in the
 * address). Two senders write tags today:
 *  - the database's `notification_push` trigger (BLOCO 117): `<kind>:<notification id>`;
 *  - the overtime ask the office posts from the app: `overtime-ask-<request id>`, whose
 *    bell row is the `overtime_new` row for that ask (BLOCO 100).
 * Any other tag (a chat line, a test push) has no bell row to mark, and is ignored.
 */
export const OPENED_PARAM = "notification";

export type OpenedNotification =
  | { by: "id"; id: string }
  | { by: "ask"; requestId: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const FROM_TRIGGER = new RegExp(`^[a-z_]+:(${UUID})$`, "i");
const FROM_ASK = new RegExp(`^overtime-ask-(${UUID})$`, "i");

export function openedNotificationFromTag(tag: string | null | undefined): OpenedNotification | null {
  if (!tag) return null;
  const t = FROM_TRIGGER.exec(tag);
  if (t) return { by: "id", id: t[1].toLowerCase() };
  const a = FROM_ASK.exec(tag);
  if (a) return { by: "ask", requestId: a[1].toLowerCase() };
  return null;
}
