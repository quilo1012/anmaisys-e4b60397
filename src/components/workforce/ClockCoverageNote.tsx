import { AlertTriangle, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClockCoverage } from "@/hooks/useClockCoverage";

/**
 * Where the TimeMoto clock actually is, said on every screen that reads it.
 *
 * Attendance prints "Nothing clocked in this period" over a period nobody has
 * imported, and the sentence cannot be told apart from a quiet month. The board runs to
 * 08/10 and the clock stops at 06/09; a reader comparing the two without being told
 * that concludes the floor was empty for four weeks.
 *
 * It is a sentence and not a card on purpose. The thing it corrects is an impression
 * picked up in passing, so it has to be read in passing too — a card would be dismissed
 * once and then stop being read, and this is true every day until somebody runs the
 * import.
 *
 * The clock can be wrong in two directions and both have to be sayable. On 05/10/2026
 * the last clocked day was 11/10 — six days AHEAD, with 210 rows in `attendance_days`
 * dated after today — and the gap was clamped at nought, so this note read "last
 * imported 11 Oct 2026 — today" and showed no warning at all. A day in the future
 * cannot have been worked, so a figure resting on it is a plan.
 */
export function ClockCoverageNote({
  todayIso,
  compact = false,
  className,
}: {
  /** The caller's operational date — see `useClockCoverage`. */
  todayIso: string;
  /** One line, for a screen where the clock is context rather than the subject. */
  compact?: boolean;
  className?: string;
}) {
  const { coverage, isLoading, isError } = useClockCoverage(todayIso);

  // Nothing at all while loading. A placeholder saying "checking the clock…" on three
  // screens is three pieces of furniture that mean nothing once it has loaded.
  if (isLoading) return null;

  // A read that failed must not be allowed to look like a clock that is up to date.
  // It stays quiet about dates it does not have and says only what it knows.
  if (isError || !coverage) {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        The clock's import status could not be read, so nothing below can be judged against it.
      </p>
    );
  }

  const { lastOnDate, daysBehind, daysAhead, stale, employeesCovered, activeEmployees } = coverage;

  if (!lastOnDate) {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-warning-strong", className)}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Nothing has ever been imported from TimeMoto. Any empty clock figure below is this, not an empty factory.
      </p>
    );
  }

  const day = new Date(`${lastOnDate}T12:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const ahead = daysAhead !== null;
  // "6 days from now" and "26 days ago" are the same measurement with opposite signs,
  // and the one thing neither may become is the word "today".
  const gap = ahead
    ? daysAhead === 1 ? "1 day from now" : `${daysAhead} days from now`
    : daysBehind === null ? ""
    : daysBehind === 0 ? "today" : daysBehind === 1 ? "1 day ago" : `${daysBehind} days ago`;
  const coverLabel = `${employeesCovered} of ${activeEmployees} active people have ever appeared in it`;

  const Icon = stale || ahead ? AlertTriangle : Clock3;
  const tone = stale || ahead ? "text-warning-strong" : "text-muted-foreground";

  if (compact) {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs", tone, className)}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>
          {ahead ? "TimeMoto carries days up to" : "TimeMoto last imported"}{" "}
          <strong className="font-medium">{day}</strong>
          {gap && <> ({gap})</>} · {employeesCovered}/{activeEmployees} people
        </span>
      </p>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-sm",
        stale || ahead ? "border-warning/40 bg-warning/5" : "border-border bg-muted/30",
        className,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} />
      <div className="min-w-0 space-y-0.5">
        <p>
          {ahead ? <>The clock carries days up to <strong>{day}</strong></>
                 : <>The clock was last imported for <strong>{day}</strong></>}
          {gap && <> — {gap}</>}, and {coverLabel}.
        </p>
        {/* The second line is the one that does the work: it names what a figure on
            this screen means, which is the mistake the note exists to stop. */}
        <p className="text-xs text-muted-foreground">
          {ahead
            ? "Days after today cannot have been worked yet, so a clock figure on them is a plan rather than a measurement."
            : "Days after that have no clock to show, so an empty figure there means not yet imported — not nobody worked."}
        </p>
      </div>
    </div>
  );
}
