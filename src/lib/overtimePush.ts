import type { OvertimeDecision, OvertimeRequest } from "@/lib/overtimeRequests";
import { windowLabel } from "@/lib/overtimeRequests";

/**
 * What the phone says.
 *
 * Short, because the lock screen cuts at about forty characters and the body at two
 * lines. The date is day-first and spelt with the weekday, because "Sat 11/10" is
 * what somebody on the floor says and "2026-10-11" is not.
 */
export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  action_url: string;
  priority: "low" | "medium" | "high";
}

const MY_OVERTIME = "/dashboard/my-overtime";

function dayLabel(onDate: string): string {
  const d = new Date(`${onDate}T00:00:00`);
  const wd = d.toLocaleDateString("en-GB", { weekday: "short" });
  const [y, m, day] = onDate.split("-");
  void y;
  return `${wd} ${day}/${m}`;
}

/** "Overtime: Sat 11/10 · 14:00–22:00" / "Need 4 · say yes or no". */
export function newAskMessage(
  r: Pick<OvertimeRequest, "id" | "on_date" | "starts_at" | "ends_at" | "headcount" | "department" | "note">,
): PushMessage {
  const where = r.department ? ` · ${r.department}` : "";
  return {
    title: `Overtime: ${dayLabel(r.on_date)} · ${windowLabel(r.starts_at, r.ends_at)}`,
    body: `Need ${r.headcount}${where}. Say yes or no in the app.${r.note ? ` ${r.note}` : ""}`,
    tag: `overtime-ask-${r.id}`,
    action_url: MY_OVERTIME,
    priority: "medium",
  };
}

/**
 * One line each. Declined gets nothing: being told you were not picked, on your
 * phone, by a robot, is worse than finding out in the app on your own time.
 */
export function decisionMessage(
  r: Pick<OvertimeRequest, "id" | "on_date" | "starts_at" | "ends_at">,
  decision: OvertimeDecision,
): PushMessage | null {
  const when = `${dayLabel(r.on_date)} · ${windowLabel(r.starts_at, r.ends_at)}`;
  switch (decision) {
    case "accepted":
      return { title: "You're in for overtime", body: when, tag: `overtime-decision-${r.id}`, action_url: MY_OVERTIME, priority: "high" };
    case "reserve":
      return { title: "You're on reserve for overtime", body: `${when}. We'll tell you if a place opens.`, tag: `overtime-decision-${r.id}`, action_url: MY_OVERTIME, priority: "medium" };
    default:
      return null;
  }
}
