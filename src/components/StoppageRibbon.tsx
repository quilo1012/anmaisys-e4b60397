import { useId } from "react";
import { format } from "date-fns";
import { mergeIntervals } from "@/lib/downtimeExclusions";
import type { Interval } from "@/lib/downtimeReconcile";
import { formatMinutes, formatDurationCompact } from "@/lib/formatDuration";

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
/** Full-strength rule on each side of an excluded slice, in user units. */
const CUT_W = 2;

/**
 * The order's clock, from the first stop to the last resume, drawn to scale.
 * Stopped spans solid; team activity hatched out of them; a tick where a
 * stoppage was corrected. Nothing else — the numbers live above it.
 *
 * The excluded slice stays in the red family on purpose. It used to be a grey
 * notch the same value as the empty track, which read as a second stoppage with
 * a gap between them — the opposite of what happened. One stoppage ran through;
 * a window inside it is discounted. So: the same red, knocked back and hatched,
 * cut at both ends by a full-strength rule.
 */
export function StoppageRibbon({ spans, exclusions, corrections = [], exclusionLabels = [] }: Props) {
  const uid = useId().replace(/:/g, "");
  const hatchId = `wo-ribbon-hatch-${uid}`;
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

  const shownExclusions = exclusionLabels.filter((ex) => ex.end > ex.start);
  const label =
    `Line down ${formatMinutes(downMin)} between ${format(new Date(t0), "HH:mm")} and ` +
    `${format(new Date(t1), "HH:mm")}` +
    (exclMin > 0 ? `, ${exclMin} minutes excluded for team activity` : "") +
    (shownExclusions.length > 0
      ? `: ${shownExclusions
          .map(
            (ex) =>
              `${ex.label} ${format(new Date(ex.start), "HH:mm")} to ${format(new Date(ex.end), "HH:mm")}`,
          )
          .join(", ")}`
      : "");

  /**
   * `tile` is in the units of whichever svg draws it: the ribbon is 1000 units wide
   * for ~1300px on screen, the legend key is 16 units wide for 16px. One tile size
   * for both would put nine stripes in the ribbon and one and a half in the key,
   * and a key that does not look like the thing it names is not a key.
   */
  const hatch = (id: string, tile = 8) => (
    <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width={tile} height={tile} className="fill-card" />
      <rect width={tile} height={tile} className="fill-destructive/20" />
      <rect width={tile * 0.375} height={tile} className="fill-destructive/85" />
    </pattern>
  );

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
          <defs>{hatch(hatchId)}</defs>

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

          {/* team activity hatched out of them, cut at both ends */}
          {mergedExcl.map(([s, e], i) => {
            const xs = x(s);
            const w = Math.max(1, x(e) - xs);
            return (
              <g key={`x${i}`}>
                <rect x={xs} y={BAR_Y} width={w} height={BAR_H} fill={`url(#${hatchId})`} />
                <rect x={xs} y={BAR_Y} width={Math.min(CUT_W, w)} height={BAR_H} className="fill-destructive" />
                <rect
                  x={xs + w - Math.min(CUT_W, w)}
                  y={BAR_Y}
                  width={Math.min(CUT_W, w)}
                  height={BAR_H}
                  className="fill-destructive"
                />
              </g>
            );
          })}

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

      {(shownExclusions.length > 0 || corrections.length > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-[2px] bg-destructive/70" />
            <span className="font-medium uppercase tracking-wide text-foreground/80">Line stopped</span>
          </span>

          {shownExclusions.map((ex, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 16 10"
                className="h-2.5 w-4 shrink-0 overflow-hidden rounded-[2px]"
              >
                <defs>{hatch(`${hatchId}-key-${i}`, 4)}</defs>
                <rect width="16" height="10" fill={`url(#${hatchId}-key-${i})`} />
                <rect width="1.5" height="10" className="fill-destructive" />
                <rect x="14.5" width="1.5" height="10" className="fill-destructive" />
              </svg>
              <span className="font-medium uppercase tracking-wide text-foreground/80">{ex.label}</span>
              <span className="font-figure tabular-nums text-muted-foreground">
                {format(new Date(ex.start), "HH:mm")}–{format(new Date(ex.end), "HH:mm")}
              </span>
              <span className="text-muted-foreground">
                · {formatDurationCompact((ex.end - ex.start) / 1000)} excluded
              </span>
            </span>
          ))}

          {corrections.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-[2px] bg-foreground" />
              <span className="text-muted-foreground">
                {corrections.length} correction{corrections.length === 1 ? "" : "s"} applied
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
