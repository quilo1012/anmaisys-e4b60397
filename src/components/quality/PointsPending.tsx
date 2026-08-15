import { cn } from "@/lib/utils";

/**
 * Stands in for a points figure that cannot be drawn yet.
 *
 * Points depend on the label attribution table. Until it arrives, any total we could
 * print would be the unfiltered one — higher than the truth, and against the wrong
 * people. A dash that resolves into a number is honest; a number that drops by three
 * a second later is not, and it is the leaders' own scores it would be wrong about.
 *
 * Same mark on all six surfaces, so it reads as "loading" rather than "broken".
 */
export function PointsPending({ failed, className }: { failed?: boolean; className?: string }) {
  return (
    <span
      className={cn("text-muted-foreground", failed ? "" : "animate-pulse", className)}
      title={
        failed
          ? "Points are unavailable: the label attribution table could not be read."
          : "Working out which actions count…"
      }
      aria-label={failed ? "Points unavailable" : "Points loading"}
    >
      —
    </span>
  );
}
