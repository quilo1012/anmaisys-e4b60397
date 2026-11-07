/**
 * What still stands between this pay period and a close nobody has to redo.
 *
 * Every item here is a case the office met by hand first (07/11/2026): overtime worked
 * after the last TimeMoto import that the close counts as 0 h; a rota day with nothing
 * worked and no leave booked that quietly ate a person's overtime; a payroll figure
 * never keyed; a database block not pasted, so the employees' screens fell back to the
 * ask's hours. The close itself is unchanged — this only says what to look at.
 *
 * Pure: the screen gathers the facts, this decides what they mean.
 */
import type { ClosePerson } from "@/lib/financeClose";
import type { PayslipDraft } from "@/lib/payslipDraft";

export type ReadinessLevel = "block" | "check" | "ok";

export interface ReadinessPerson {
  employeeId: string;
  name: string;
  /** What about them, short: "20 h, 03/11 + 04/11". */
  detail: string;
}

export interface ReadinessItem {
  key: "clock" | "overtimeNotOnClock" | "absentNoLeave" | "payrollMissing" | "pendingBlocks";
  level: ReadinessLevel;
  title: string;
  /** What to do about it. */
  action: string | null;
  people: ReadinessPerson[];
}

export interface ReadinessInput {
  rows: ReadonlyArray<ClosePerson>;
  /** One per row, from `assemblePayslipDrafts`. Null while it loads or if it failed. */
  drafts: ReadonlyArray<PayslipDraft> | null;
  /** The last day `attendance_days` holds for anybody. Null = never imported. */
  clockReach: string | null;
  /** The last day the close counts (the period's end, or yesterday while it runs). */
  to: string;
  /** Database blocks the screens are waiting on, already worded: "BLOCO 153 — …". */
  pendingBlocks: ReadonlyArray<string>;
}

const short = (d: string) => d.split("-").reverse().slice(0, 2).join("/");

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function closeReadiness(input: ReadinessInput): { items: ReadinessItem[]; ready: boolean; open: number } {
  const { rows, drafts, clockReach, to } = input;
  const items: ReadinessItem[] = [];

  // The clock first: every hour figure on the close waits on it.
  const gap = clockReach == null ? null : Math.max(0, daysBetween(clockReach, to));
  items.push(
    clockReach == null
      ? { key: "clock", level: "block", title: "No clock record has been imported for this period", action: "Import the TimeMoto export before closing.", people: [] }
      : gap! > 0
        ? { key: "clock", level: "block", title: `Clock records reach ${short(clockReach)}: ${gap} ${gap === 1 ? "day" : "days"} of the period have no hours yet`, action: "Import the latest TimeMoto export, then check again.", people: [] }
        : { key: "clock", level: "ok", title: `Clock records reach ${short(clockReach)}, the whole period`, action: null, people: [] },
  );

  if (drafts) {
    const byId = new Map(drafts.map((d) => [d.header.employeeId, d]));
    const notOnClock: ReadinessPerson[] = [];
    const absent: ReadinessPerson[] = [];
    let notOnClockSum = 0;
    for (const r of rows) {
      const d = byId.get(r.employeeId);
      if (!d) continue;
      if (d.overtime.notOnClockHours > 0) {
        const dates = d.overtime.shifts
          .filter((s) => !d.days.some((x) => x.date === s.date && x.workedHours != null && x.workedHours > 0))
          .map((s) => short(s.date));
        notOnClockSum += d.overtime.notOnClockHours;
        notOnClock.push({ employeeId: r.employeeId, name: r.name, detail: `${d.overtime.notOnClockHours} h, ${dates.join(" + ")}` });
      }
      if (d.absences.absent > 0) {
        absent.push({ employeeId: r.employeeId, name: r.name, detail: d.absences.absentDates.map(short).join(", ") });
      }
    }
    const hours = Math.round(notOnClockSum * 100) / 100;
    items.push(notOnClock.length
      ? { key: "overtimeNotOnClock", level: "block", title: `${notOnClock.length} ${notOnClock.length === 1 ? "person has" : "people have"} ${hours} h of overtime the clock does not have yet`, action: "The close counts these as 0 h until the clock is imported. Their payslip draft and phone already count them.", people: notOnClock }
      : { key: "overtimeNotOnClock", level: "ok", title: "Every overtime shift worked is on the clock", action: null, people: [] });
    items.push(absent.length
      ? { key: "absentNoLeave", level: "check", title: `${absent.length} ${absent.length === 1 ? "person was" : "people were"} away on a rota day with no leave booked`, action: "Book the holiday, sickness or unpaid day if there was one — overtime repays these hours first.", people: absent }
      : { key: "absentNoLeave", level: "ok", title: "No rota day away without leave booked", action: null, people: [] });
  }

  const unpaidOt = rows.filter((r) => (r.overtimeHours ?? 0) > 0 && r.payrollOtHours == null);
  items.push(unpaidOt.length
    ? { key: "payrollMissing", level: "check", title: `Payroll OT not recorded for ${unpaidOt.length} ${unpaidOt.length === 1 ? "person" : "people"} with overtime on the clock`, action: "Key their payroll figure in the overtime register below.", people: unpaidOt.map((r) => ({ employeeId: r.employeeId, name: r.name, detail: `${r.overtimeHours} h on the clock` })) }
    : { key: "payrollMissing", level: "ok", title: "Payroll OT recorded for everybody with overtime", action: null, people: [] });

  // Only when one is known to be missing: the probe list covers the blocks that carry a
  // safe call, so silence here is not proof the database is current.
  if (input.pendingBlocks.length) {
    items.push({ key: "pendingBlocks", level: "check", title: `Database update not applied: ${input.pendingBlocks.join("; ")}`, action: "Paste the block in the SQL editor; until then the screens fall back.", people: [] });
  }

  const open = items.filter((i) => i.level !== "ok").length;
  return { items, ready: items.every((i) => i.level !== "block"), open };
}
