import { cn } from "@/lib/utils";
import { isEstimateRate } from "@/lib/smartTargetRates";
import type { ShiftForecast } from "@/lib/smartTargetEngine";

/**
 * A line's shift as a strip: each block is as wide as the time the forecast gives it, so where
 * the shift goes can be read without opening anything. Three sample batches filling Line 2's
 * day are obvious here and were buried in a sentence before.
 */

export interface StripSegment {
  kind: "setup" | "run";
  jobId: string;
  sku: string | null;
  /** Percent of the shift. */
  left: number;
  width: number;
  /** The rate behind it is an estimate. */
  estimated: boolean;
  /** Which job along the line, for telling neighbouring runs apart. */
  index: number;
  minutes: number;
  expected: number | null;
}

export function stripSegments(result: ShiftForecast): { segments: StripSegment[]; notReached: string[]; noTime: string[] } {
  const gross = result.window?.grossMinutes ?? 720;
  const pct = (minutes: number) => Math.min(100, Math.max(0, (minutes / gross) * 100));
  const segments: StripSegment[] = [];
  const notReached: string[] = [];
  const noTime: string[] = [];
  result.jobs.forEach((job, index) => {
    const a = job.allocation;
    if (!a) {
      if (job.sku && !noTime.includes(job.sku)) noTime.push(job.sku);
      return;
    }
    if (a.end <= a.setupEnd) {
      if (job.sku && !notReached.includes(job.sku)) notReached.push(job.sku);
      return;
    }
    const base = { jobId: job.jobId, sku: job.sku, estimated: isEstimateRate(job.rate?.source), index, expected: job.expectedContainers };
    if (a.setupEnd > a.start) {
      segments.push({ ...base, kind: "setup", left: pct(a.start), width: pct(a.setupEnd) - pct(a.start), minutes: a.setupEnd - a.start });
    }
    segments.push({ ...base, kind: "run", left: pct(a.setupEnd), width: pct(a.end) - pct(a.setupEnd), minutes: a.end - a.setupEnd });
  });
  return { segments, notReached, noTime };
}

/** Hour labels every two hours along a shift of `gross` minutes. */
export function stripHours(firstHour: number, gross: number): { label: string; left: number }[] {
  const out: { label: string; left: number }[] = [];
  for (let minutes = 0; minutes <= gross; minutes += 120) {
    out.push({ label: String((firstHour + minutes / 60) % 24).padStart(2, "0"), left: (minutes / gross) * 100 });
  }
  return out;
}

// Changeover is planned time, not a fault: drawn as a quiet grey hatch so the green runs carry the strip.
const HATCH = "repeating-linear-gradient(135deg, hsl(var(--muted-foreground) / 0.35) 0 2px, transparent 2px 6px)";

export function ShiftStrip({ result, nowPct }: { result: ShiftForecast; nowPct: number | null }) {
  const { segments } = stripSegments(result);
  return (
    <div className="relative h-9 overflow-hidden rounded-md bg-muted/60 ring-1 ring-inset ring-border/60" aria-hidden="true">
      {segments.map((s) =>
        s.kind === "setup" ? (
          <div
            key={`${s.jobId}-setup`}
            className="absolute inset-y-0"
            style={{ left: `${s.left}%`, width: `${s.width}%`, backgroundImage: HATCH }}
            title={`Changeover and mixing before ${s.sku ?? "this job"}: ${Math.round(s.minutes)} min`}
          />
        ) : (
          <div
            key={`${s.jobId}-run`}
            className={cn(
              "absolute inset-y-0 flex items-center overflow-hidden px-1.5 text-2xs font-medium",
              s.estimated
                ? "border border-dashed border-success/70 bg-success/5 text-success-strong"
                : s.index % 2
                  ? "bg-success/70 text-success-foreground"
                  : "bg-success text-success-foreground",
            )}
            style={{ left: `${s.left}%`, width: `${s.width}%` }}
            title={`${s.sku ?? "No SKU"}: ${s.expected?.toLocaleString() ?? "—"} in ${Math.round(s.minutes)} min${s.estimated ? " (estimate)" : ""}`}
          >
            {s.width >= 9 && <span className="truncate font-mono">{s.sku}</span>}
          </div>
        ),
      )}
      {segments.length === 0 && <div className="flex h-full items-center px-2 text-xs text-muted-foreground">No time worked out yet</div>}
      {nowPct !== null && <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${nowPct}%` }} />}
    </div>
  );
}
