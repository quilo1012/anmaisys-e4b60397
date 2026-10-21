import type { MyShift } from "@/lib/myAttendance";

export const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const KIND_LABEL: Record<MyShift["kind"], string> = {
  scheduled: "Scheduled", overtime: "Overtime", training: "Training",
  holiday: "Holiday", sick: "Sickness", unpaid: "Unpaid leave", other: "Away",
};

/** The column, or the honest version of not knowing it. */
export function areaText(sh: MyShift): string {
  if (sh.area) return sh.leader ? `${sh.area} (leader)` : sh.area;
  if (sh.area === undefined) return "—";
  return "Work area not yet assigned";
}

export const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
