import { cn } from "@/lib/utils";
import { londonTime as hm, type LineReport } from "@/lib/shiftReport";

const n = (v: number | null) => (v === null ? "—" : v.toLocaleString());

/**
 * How a line did against its target, as a tone. Green when it met the target or came
 * within the margin, amber when it fell short by more. Never red: a miss here is a
 * forecast to look at, not a fault. While the shift is still running the comparison is
 * not finished, so it stays neutral.
 */
export type ResultTone = "good" | "short" | "neutral";

export const MISS_MARGIN = 15;

export function resultTone(miss: number | null, running: boolean): ResultTone {
  if (miss === null || running) return "neutral";
  return miss <= MISS_MARGIN ? "good" : "short";
}

export const TONE_TEXT: Record<ResultTone, string> = {
  good: "text-success-strong",
  short: "text-warning-strong",
  neutral: "text-muted-foreground",
};

/** Logged against target as a bar: green fill, capped at the target. */
export function TargetBar({ target, logged, className }: { target: number | null; logged: number; className?: string }) {
  if (!target || target <= 0) return null;
  const pct = Math.min(100, (logged / target) * 100);
  return (
    <div
      className={cn("h-1.5 overflow-hidden rounded-full bg-success/15", className)}
      role="meter"
      aria-label="Logged against target"
      aria-valuemin={0}
      aria-valuemax={target}
      aria-valuenow={logged}
    >
      <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One line's shift: what was expected, what happened, where the time went, and why. */
export function ShiftReport({ report }: { report: LineReport }) {
  const { clock } = report;
  // Stops inside a silence can't be set against the log, so the sum only holds without one.
  const unaccounted = clock && !clock.gaps.length ? clock.coveredMinutes - clock.runningMinutes - report.stopMinutes : 0;
  return (
    <section className="grid gap-4 text-sm md:grid-cols-3" data-testid={`shift-report-${report.line}`} aria-label={`Line ${report.line} shift report`}>
      <div>
        <h4 className="font-semibold">Expected</h4>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">Target</dt>
          <dd className="tabular-nums">{n(report.target)}{report.targetSetAt ? `, set ${hm(report.targetSetAt)}` : ""}</dd>
          <dt className="text-muted-foreground">RAG plan</dt>
          <dd className="tabular-nums">{n(report.ragPlan)}</dd>
          <dt className="text-muted-foreground">Products</dt>
          <dd>{report.planned.length ? report.planned.map((p) => (p.expected === null ? p.sku : `${p.sku} ${p.expected.toLocaleString()}`)).join(", ") : "—"}</dd>
        </dl>
        <h4 className="mt-3 font-semibold">What happened</h4>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">Logged</dt>
          <dd className="tabular-nums">{report.logged > 0 ? report.logged.toLocaleString() : "—"}</dd>
          <dt className="text-muted-foreground">Products</dt>
          <dd>{report.made.length ? report.made.map((m) => `${m.sku} ${m.qty.toLocaleString()}`).join(", ") : "—"}</dd>
          {report.leader && (
            <>
              <dt className="text-muted-foreground">Leader</dt>
              <dd>{report.leader}</dd>
            </>
          )}
        </dl>
      </div>
      <div>
        <h4 className="font-semibold">Where the time went</h4>
        {clock ? (
          <p className="mt-1">
            First ran {hm(clock.firstRun)}, last ran {hm(clock.lastRun)}. <span className={cn("tabular-nums", clock.runningMinutes > 0 && "font-medium text-success-strong")}>Running {clock.runningMinutes} min</span>
            <span className="text-muted-foreground"> (iTouch)</span>
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">No machine log for this shift, so running time is not known.</p>
        )}
        {clock?.gaps.map((g) => (
          <p key={g.from} className="text-xs text-muted-foreground">The machine log was off from {hm(g.from)} to {hm(g.to)}, so that time is not counted.</p>
        ))}
        {report.stops.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {report.stops.slice(0, 6).map((s) => (
              <li key={s.reason}>
                <div className="flex justify-between gap-3"><span>{s.reason}</span><span className="tabular-nums text-muted-foreground">{s.minutes} min</span></div>
                <div className="h-1 rounded-full bg-muted"><div className="h-1 rounded-full bg-muted-foreground/45" style={{ width: `${Math.min(100, (s.minutes / report.grossMinutes) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-success-strong">No stops logged.</p>
        )}
        {unaccounted > 0 && <p className="mt-2 text-xs text-muted-foreground">{unaccounted} min neither running nor logged as a stop.</p>}
      </div>
      <div>
        <h4 className="font-semibold">Why</h4>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">{report.why.map((w) => <li key={w}>{w}</li>)}</ul>
        {report.comment && (
          <>
            <h4 className="mt-3 font-semibold">Comment</h4>
            <p className="mt-1">{report.comment}</p>
          </>
        )}
      </div>
    </section>
  );
}

const TONE_LABEL: Record<ResultTone, string> = { good: "On target", short: "Short of target", neutral: "In progress" };
const TONE_CHIP: Record<ResultTone, string> = {
  good: "border-success/40 bg-success/10 text-success-strong",
  short: "border-warning/40 bg-warning/10 text-warning-strong",
  neutral: "border-border bg-muted text-muted-foreground",
};

/** A line worth a detail block on paper: it had a target, logged something, ran, or stopped. */
const hasActivity = (r: LineReport) =>
  r.target !== null || r.logged > 0 || r.stops.length > 0 || (r.clock?.runningMinutes ?? 0) > 0;

/**
 * The printed shift report: a title block, one summary table with every line on it, then
 * each line's detail, and a sign-off at the end. Hidden on screen; the print copy shows it.
 */
export function PrintShiftReport({ reports, date, shift, running }: { reports: LineReport[]; date: string; shift: "DAY" | "NIGHT"; running: boolean }) {
  const withTarget = reports.filter((r) => r.target !== null);
  const totalTarget = withTarget.length ? withTarget.reduce((s, r) => s + (r.target ?? 0), 0) : null;
  const totalLogged = reports.reduce((s, r) => s + r.logged, 0);
  const totalStops = reports.reduce((s, r) => s + r.stopMinutes, 0);
  const onTarget = reports.filter((r) => resultTone(r.miss, running) === "good").length;
  const printedAt = new Date().toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });
  const shiftName = shift === "DAY" ? "Day shift, 06:00–18:00" : "Night shift, 18:00–06:00";
  const dateName = new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="smart-target-print text-[9pt] leading-snug text-black">
      <header className="flex items-end justify-between gap-6 border-b-2 border-success pb-2">
        <div>
          <p className="text-[8pt] font-medium text-success-strong">Production</p>
          <h2 className="text-[16pt] font-semibold leading-tight">Smart Target shift report</h2>
          <p className="mt-0.5 text-[10pt]">{dateName}, {shiftName}</p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 text-right text-[8pt] text-neutral-600">
          <dt>Printed</dt>
          <dd className="tabular-nums">{printedAt}</dd>
          <dt>Status</dt>
          <dd>{running ? "Shift still running" : "Shift closed"}</dd>
        </dl>
      </header>

      <section className="mt-3 grid grid-cols-4 gap-3" aria-label="Shift totals">
        {[
          { label: "Target, all lines", value: n(totalTarget) },
          { label: "Logged", value: totalLogged > 0 ? totalLogged.toLocaleString() : "—", strong: true },
          { label: "Lines on target", value: running ? "—" : `${onTarget} of ${withTarget.length}` },
          { label: "Stops logged", value: `${totalStops.toLocaleString()} min` },
        ].map((k) => (
          <div key={k.label} className={cn("rounded border px-3 py-2", k.strong ? "border-success/50 bg-success/5" : "border-neutral-300")}>
            <p className="text-[8pt] text-neutral-600">{k.label}</p>
            <p className={cn("text-[14pt] font-semibold tabular-nums", k.strong && "text-success-strong")}>{k.value}</p>
          </div>
        ))}
      </section>
      {totalTarget !== null && <TargetBar target={totalTarget} logged={totalLogged} className="mt-2 h-2" />}

      <table className="mt-4 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-neutral-400 text-left text-[8pt] text-neutral-600">
            <th className="py-1 pr-2 font-medium">Line</th>
            <th className="py-1 pr-2 text-right font-medium">Target</th>
            <th className="py-1 pr-2 text-right font-medium">RAG plan</th>
            <th className="py-1 pr-2 text-right font-medium">Logged</th>
            <th className="py-1 pr-2 font-medium">Against target</th>
            <th className="py-1 pr-2 text-right font-medium">Running</th>
            <th className="py-1 pr-2 text-right font-medium">Stops</th>
            <th className="py-1 pl-3 font-medium">Leader</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => {
            const tone = resultTone(r.miss, running);
            return (
              <tr key={r.line} className="border-b border-neutral-200 align-middle">
                <td className="py-1.5 pr-2 font-semibold">Line {r.line}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{n(r.target)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{n(r.ragPlan)}</td>
                <td className="py-1.5 pr-2 text-right font-medium tabular-nums">{r.logged > 0 ? r.logged.toLocaleString() : "—"}</td>
                <td className="w-[22%] py-1.5 pr-2">
                  <div className="flex items-center gap-2">
                    <TargetBar target={r.target} logged={r.logged} className="flex-1" />
                    <span className={cn("shrink-0 rounded border px-1.5 text-[7.5pt] font-medium", TONE_CHIP[tone])}>
                      {r.target === null ? "No target" : TONE_LABEL[tone]}
                    </span>
                  </div>
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.clock ? `${r.clock.runningMinutes} min` : "—"}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.stopMinutes ? `${r.stopMinutes} min` : "—"}</td>
                <td className="py-1.5 pl-3">{r.leader ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {reports.filter(hasActivity).map((r) => (
        <div key={r.line} className="mt-4 break-inside-avoid rounded border border-neutral-300">
          <div className="flex items-baseline justify-between border-b border-neutral-300 bg-success/5 px-3 py-1.5">
            <h3 className="text-[11pt] font-semibold">Line {r.line}</h3>
            <span className="text-[8pt] tabular-nums text-neutral-600">
              Target {n(r.target)}, logged {r.logged > 0 ? r.logged.toLocaleString() : "—"}
            </span>
          </div>
          <div className="px-3 py-2">
            <ShiftReport report={r} />
          </div>
        </div>
      ))}

      {reports.some((r) => !hasActivity(r)) && (
        <p className="mt-3 text-[8pt] text-neutral-600">
          No target, nothing logged and no machine time on {reports.filter((r) => !hasActivity(r)).map((r) => `Line ${r.line}`).join(", ")}.
        </p>
      )}

      <footer className="mt-6 grid grid-cols-2 gap-10 break-inside-avoid text-[8pt] text-neutral-600">
        {["Shift leader", "Production manager"].map((who) => (
          <div key={who}>
            <div className="h-8 border-b border-neutral-500" />
            <p className="mt-1">{who}: name, signature and time</p>
          </div>
        ))}
      </footer>
    </div>
  );
}
