import { cn } from "@/lib/utils";
import { pointsBreakdown } from "@/lib/qualityConstants";
import { PointsPending } from "@/components/quality/PointsPending";

/**
 * What this action costs its leader, and the arithmetic that got there.
 *
 * The screen this replaces showed a severity badge, a row of labels, and no number
 * at all — so the one figure a leader is appraised on was the only thing the detail
 * dialog would not tell them. Worse, where the number did appear (a column in the
 * log) it appeared alone: 5 points against "Batch code · Maintenance" is either the
 * attribution rule not being in force or Batch code priced at 5 on its own, and the
 * module gave no way to tell which.
 *
 * So it is drawn as a weighbridge ticket, which is the instrument this factory
 * already trusts for exactly this job: one figure, and beneath it the line items
 * that add up to it, including the ones that were taken off. A charge you cannot
 * itemise is a charge nobody should have to accept.
 *
 * `spared` lines are struck through and named rather than omitted. A total that has
 * quietly had something removed is indistinguishable from a total that never had it,
 * and "Maintenance is not the leader's" is a rule the factory decided on — it should
 * be visible on the action it changed, not buried in a settings dialog.
 */
export function ActionScore({
  action,
  excluded,
  ready,
  failed,
  className,
}: {
  action: { domain?: string | null; severity: string | null; labels?: string[] | null; validation_status?: string | null };
  excluded: Set<string>;
  /** Attribution has loaded. Until it has, an empty set reads as "nothing excluded". */
  ready: boolean;
  failed?: boolean;
  className?: string;
}) {
  // Deliberately not "0 while loading". An empty exclusion set is a VALID answer
  // meaning nothing is excluded, so a score drawn early is the UNFILTERED one — too
  // high, against the wrong person, and it settles a moment later as if it had been
  // right all along. See useLeaderAttribution.
  if (!ready) {
    return (
      <section className={cn("rounded-lg border bg-muted/20 p-3", className)}>
        <Heading />
        <PointsPending failed={failed} className="font-figure text-3xl" />
      </section>
    );
  }

  const b = pointsBreakdown(action, excluded);
  const items = [
    ...b.charged.map((c) => ({ ...c, spared: false })),
    ...b.spared.map((s) => ({ ...s, spared: true })),
  ];

  return (
    <section
      className={cn("rounded-lg border bg-muted/20 p-3", className)}
      aria-label={`Score: ${b.explanation}`}
    >
      <Heading />
      <div className="mt-2 flex items-start gap-4">
        {/* The figure leads. Whoever opens this needs the price first and the
            reasoning second — the reverse is how people stop reading it. */}
        <p className="flex shrink-0 items-baseline gap-1">
          <span
            className={cn(
              "font-figure text-3xl leading-none",
              b.points === 0 && "text-muted-foreground",
            )}
          >
            {b.points}
          </span>
          <span className="text-2xs uppercase tracking-wide text-muted-foreground">
            {b.points === 1 ? "pt" : "pts"}
          </span>
        </p>

        <div className="min-w-0 flex-1 space-y-1">
          {items.length > 0 ? (
            <ul className="space-y-0.5">
              {items.map((i) => (
                <li key={`${i.label}:${i.spared}`} className="flex items-baseline gap-1.5 text-xs">
                  {/* break-normal: index.css sets overflow-wrap:anywhere globally, which
                      splits a label down the middle in a column this narrow. */}
                  <span className={cn("break-normal", i.spared && "text-muted-foreground line-through")}>
                    {i.label}
                  </span>
                  {/* The dotted leader carries the eye across the gap, the way a ticket
                      does. It is a rule, not text, so it never gets read aloud. */}
                  <span aria-hidden className="min-w-4 flex-1 translate-y-[-0.15em] border-b border-dotted border-border" />
                  <span className={cn("font-figure shrink-0", i.spared && "text-muted-foreground line-through")}>
                    {i.points}
                  </span>
                  {i.spared && (
                    <span className="shrink-0 rounded border border-warning/40 bg-warning/10 px-1 py-px text-2xs text-warning-strong">
                      not the leader's
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {/* The sentence, always — it is the only thing that says WHY when there are
              no line items to show (a grade paid it, Quality rejected it, safety is
              never charged), and it is what a screen reader gets. */}
          <p className={cn("text-2xs text-muted-foreground", items.length > 0 && "pt-0.5")}>
            {b.explanation}
          </p>
        </div>
      </div>
    </section>
  );
}

function Heading() {
  return (
    <h3 className="font-display text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      Score
    </h3>
  );
}
