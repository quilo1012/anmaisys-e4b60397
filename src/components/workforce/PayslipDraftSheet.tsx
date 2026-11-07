/**
 * The payslip draft on paper: one A4 per person, hours only (decided 07/11/2026).
 * Every figure is `buildPayslipDraft`'s; this only lays it out.
 */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { printElementAsDocument } from "@/lib/printDocument";
import { ukDate, type PayslipDraft } from "@/lib/payslipDraft";

/** "12 h", "−3.5 h", or "—" for a figure that is not known. */
export const fmtH = (n: number | null, signed = false) =>
  n == null ? "—" : `${signed && n > 0 ? "+" : ""}${String(n).replace("-", "−")} h`;
const fmtN = (n: number | null, signed = false) =>
  n == null ? "—" : `${signed && n > 0 ? "+" : ""}${String(n).replace("-", "−")}`;
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const weekday = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short" });

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td className="py-0.5 pr-2">{label}</td>
      <td className={`py-0.5 text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</td>
    </tr>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="payslip-block">
      <h3 className="mb-1 border-b border-black pb-0.5 text-[9pt] font-bold uppercase tracking-wide">{title}</h3>
      <table className="w-full text-[8.5pt]"><tbody>{children}</tbody></table>
    </div>
  );
}

export function PayslipDraftSheet({ draft, generatedAt }: { draft: PayslipDraft; generatedAt: Date }) {
  const { header: h, schedule: s, hours, overtime: ot, absences: a } = draft;
  return (
    <article className="payslip-sheet text-black" data-testid="payslip-draft">
      <div className="mb-2 border-2 border-black px-2 py-1 text-center text-[9pt] font-bold tracking-wide">
        DRAFT — HOURS ONLY · NOT A PAYSLIP · NO PAY AMOUNTS
      </div>

      {/* A div, not a <header>: the app's print sheet hides every <header> that is not
          `.print-keep`, and the name and period went missing from the paper (07/11). */}
      <div className="payslip-head mb-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[14pt] font-bold leading-tight">{h.name}</h1>
          <p className="text-[8.5pt]">
            {[h.employeeRef && `No. ${h.employeeRef}`, h.department, h.line, h.crew && `${h.crew} crew`, h.rota]
              .filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        <div className="text-right text-[8.5pt]">
          <p className="text-[11pt] font-bold">{h.periodName}</p>
          <p>{ukDate(h.periodFrom)} – {ukDate(h.periodTo)}</p>
          {h.countedTo && <p className="font-semibold">Period still running: counted to {ukDate(h.countedTo)}</p>}
          <p>Generated {generatedAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</p>
        </div>
      </div>

      <section className="mb-2 grid grid-cols-2 gap-x-6 gap-y-2">
        <Block title="Schedule">
          <Row label="Shifts due" value={fmtN(s.due)} />
          <Row label="Shifts worked" value={String(s.worked)} />
          <Row label="Shifts +/−" value={fmtN(s.balance, true)} strong />
        </Block>
        <Block title="Hours">
          <Row label="Contracted hours" value={fmtH(hours.contracted)} />
          <Row label="Hours worked" value={fmtH(hours.worked)} />
          <Row label="Period balance" value={fmtH(hours.balance, true)} strong />
        </Block>
        <Block title="Overtime">
          <Row label="Overtime for the period" value={fmtH(ot.periodHours)} strong />
          <Row label="Overtime (clock)" value={fmtH(ot.clockHours)} />
          <Row label="Approved by payroll" value={ot.payrollHours == null ? "Not recorded yet" : fmtH(ot.payrollHours)} />
          <Row label="Hours owed" value={fmtH(ot.owedHours)} />
          <Row label="Overtime shifts worked" value={`${ot.shifts.length} · ${fmtH(ot.shiftsHours)}`} />
        </Block>
        <Block title="Absences">
          <Row label="Holiday" value={days(a.holiday)} />
          <Row label="Sick" value={days(a.sick)} />
          <Row label="Unpaid leave" value={days(a.unpaid)} />
          <Row label="Other" value={days(a.other)} />
          <Row
            label="Absent (no leave booked)"
            value={`${days(a.absent)}${a.absentDates.length > 0 && a.absentDates.length <= 3
              ? ` (${a.absentDates.map((x) => `${weekday(x)} ${ukDate(x).slice(0, 5)}`).join(", ")})` : ""}`}
          />
          <Row label="Part days, unpaid" value={fmtH(a.partDayHours)} />
        </Block>
      </section>

      {hours.note && <p className="mb-1 text-[8pt] font-semibold">{hours.note}</p>}
      {ot.periodNote && <p className="mb-1 text-[8pt]">Overtime for the period: {ot.periodNote}.</p>}
      {ot.coveredNote && <p className="mb-1 text-[8pt]">{ot.coveredNote}</p>}
      {ot.shifts.length > 0 && (
        <p className="mb-2 text-[8pt]">
          <span className="font-semibold">Overtime shifts: </span>
          {ot.shifts.map((x) => `${weekday(x.date)} ${ukDate(x.date).slice(0, 5)} ${x.hours}${x.where ? ` (${x.where})` : ""}`).join(" · ")}
        </p>
      )}

      <table className="payslip-days w-full text-[7.5pt]">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-0.5">Date</th><th>Rota</th><th>In</th><th>Out</th>
            <th className="text-right">Worked</th><th className="pl-2">Day</th>
          </tr>
        </thead>
        <tbody>
          {draft.days.map((d) => (
            <tr key={d.date} className="border-b border-black/20">
              <td className="py-px">{weekday(d.date)} {ukDate(d.date)}</td>
              <td>{d.rota}</td>
              <td>{d.clockIn ?? "—"}</td>
              <td>{d.clockOut ?? "—"}</td>
              <td className="text-right tabular-nums">{fmtH(d.workedHours)}</td>
              <td className="pl-2">{d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[7pt]">
        Figures as recorded when generated: overtime settles over the whole pay period, a shortfall first.
        This draft is for checking hours. It is not a statement of pay.
      </p>
    </article>
  );
}

const SHEET_CSS = `
  body { padding: 10mm 12mm; }
  .payslip-sheet { break-after: page; page-break-after: always; }
  .payslip-sheet:last-child { break-after: auto; page-break-after: auto; }
  .payslip-block { break-inside: avoid; }
  .payslip-days tr { break-inside: avoid; }
`;

/** One A4 per draft, through the isolated print document every report uses. */
export async function printPayslipDrafts(drafts: PayslipDraft[], title: string): Promise<void> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;";
  document.body.appendChild(host);
  const root = createRoot(host);
  const generatedAt = new Date();
  try {
    flushSync(() => {
      root.render(<div>{drafts.map((d) => <PayslipDraftSheet key={d.header.employeeId} draft={d} generatedAt={generatedAt} />)}</div>);
    });
    await printElementAsDocument(host.firstElementChild as HTMLElement, title, { css: SHEET_CSS });
  } finally {
    root.unmount();
    host.remove();
  }
}
