import { londonTime as hm, type LineReport } from "@/lib/shiftReport";

const n = (v: number | null) => (v === null ? "—" : v.toLocaleString());

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
          <dd>{report.planned.length ? report.planned.map((p) => p.sku).join(", ") : "—"}</dd>
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
            First ran {hm(clock.firstRun)}, last ran {hm(clock.lastRun)}. <span className="tabular-nums">Running {clock.runningMinutes} min</span>
            <span className="text-muted-foreground"> (iTouch)</span>
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">No machine log for this shift, so running time is not known.</p>
        )}
        {clock?.gaps.map((g) => (
          <p key={g.from} className="text-xs text-warning-strong">The machine log was off from {hm(g.from)} to {hm(g.to)}, so that time is not counted.</p>
        ))}
        {report.stops.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {report.stops.slice(0, 6).map((s) => (
              <li key={s.reason}>
                <div className="flex justify-between gap-3"><span>{s.reason}</span><span className="tabular-nums text-muted-foreground">{s.minutes} min</span></div>
                <div className="h-1 rounded-full bg-muted"><div className="h-1 rounded-full bg-warning" style={{ width: `${Math.min(100, (s.minutes / report.grossMinutes) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted-foreground">No stops logged.</p>
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
