import { format } from "date-fns";
import { mergeIntervals, type Interval } from "@/lib/downtimeExclusions";
import { formatMinutes } from "@/lib/formatDuration";

interface Props {
  /** Merged stopped spans, in ms — the same spans the total is computed from. */
  spans: Interval[];
  /** Merged team-activity exclusion intervals, in ms. */
  exclusions: Interval[];
  /** Instants (ms) where a correction was applied to a stoppage. */
  corrections?: number[];
  /** Labels for the exclusion intervals, aligned with `exclusions` where known. */
  exclusionLabels?: Array<{ start: number; end: number; label: string }>;
}

const VB_W = 1000;
const VB_H = 44;
const BAR_Y = 10;
const BAR_H = 20;

/**
 * The order's clock, from the first stop to the last resume, drawn to scale.
 * Stopped spans solid; team activity notched out of them; a tick where a
 * stoppage was corrected. Nothing else — the numbers live above it.
 */
export function StoppageRibbon({ spans, exclusions, corrections = [], exclusionLabels = [] }: Props) {
  const merged = mergeIntervals(spans);
  if (merged.length === 0) return null;

  const t0 = merged[0][0];
  const t1 = merged[merged.length - 1][1];
  const total = t1 - t0;
  if (!(total > 0)) return null;

  const x = (t: number) => ((Math.min(Math.max(t, t0), t1) - t0) / total) * VB_W;

  const mergedExcl = mergeIntervals(exclusions).filter(([s, e]) => e > t0 && s < t1);
  const downMs = merged.reduce((acc, [s, e]) => acc + (e - s), 0);
  const exclMs = merged.reduce(
    (acc, [s, e]) =>
      acc + mergedExcl.reduce((a, [xs, xe]) => a + Math.max(0, Math.min(e, xe) - Math.max(s, xs)), 0),
    0,
  );
  const downMin = Math.round((downMs - exclMs) / 60000);
  const exclMin = Math.round(exclMs / 60000);

  const label =
    `Line down ${formatMinutes(downMin)} between ${format(new Date(t0), "HH:mm")} and ` +
    `${format(new Date(t1), "HH:mm")}` +
    (exclMin > 0 ? `, ${exclMin} minutes excluded for team activity` : "");

  return (
    <div className="print:hidden" role="img" aria-label={label}>
      <div className="overflow-x-auto">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="h-11 w-full min-w-[280px]"
        >
          <defs>
            <pattern id="wo-ribbon-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" className="fill-muted" />
              <rect width="3" height="8" className="fill-muted-foreground/40" />
            </pattern>
          </defs>

          {/* the whole clock */}
          <rect x={0} y={BAR_Y} width={VB_W} height={BAR_H} rx={2} className="fill-muted/60" />

          {/* stopped spans */}
          {merged.map(([s, e], i) => (
            <rect
              key={`s${i}`}
              x={x(s)}
              y={BAR_Y}
              width={Math.max(1, x(e) - x(s))}
              height={BAR_H}
              className="fill-destructive/70"
            />
          ))}

          {/* team activity notched out of them */}
          {mergedExcl.map(([s, e], i) => (
            <rect
              key={`x${i}`}
              x={x(s)}
              y={BAR_Y}
              width={Math.max(1, x(e) - x(s))}
              height={BAR_H}
              fill="url(#wo-ribbon-hatch)"
            />
          ))}

          {/* corrections */}
          {corrections.map((t, i) => (
            <rect
              key={`c${i}`}
              x={Math.max(0, x(t) - 1)}
              y={BAR_Y - 6}
              width={2}
              height={BAR_H + 12}
              className="fill-foreground"
            />
          ))}
        </svg>
      </div>

      <div className="mt-1 flex items-center justify-between gap-3 font-figure text-2xs tabular-nums text-muted-foreground">
        <span>{format(new Date(t0), "HH:mm")}</span>
        <span>{format(new Date(t1), "HH:mm")}</span>
      </div>

      {(exclusionLabels.length > 0 || corrections.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
          {exclusionLabels.map((x, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 rounded-[1px] border border-border bg-muted" />
              {x.label} · <span className="font-figure tabular-nums">{format(new Date(x.start), "HH:mm")}–{format(new Date(x.end), "HH:mm")}</span>
            </span>
          ))}
          {corrections.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-[2px] bg-foreground" />
              {corrections.length} correction{corrections.length === 1 ? "" : "s"} applied
            </span>
          )}
        </div>
      )}
    </div>
  );
}
