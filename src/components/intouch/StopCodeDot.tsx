import { stopColour, isAmbiguousStop } from "@/lib/intouchStopColours";
import { cn } from "@/lib/utils";

/**
 * The colour iTouching paints this stop code, beside the name of it.
 *
 * The performance board already wears these colours, and they are the ones the floor
 * reads all shift on iTouching's own panel. The screens that *list* the codes —
 * the catalogue somebody edits, the planned stops somebody switches on and off — were
 * still plain text, so the one place you would go to check whether a code is the right
 * colour was the one place that could not tell you.
 *
 * A code iTouching does not paint gets no dot rather than a grey one. An absent mark
 * says "this name is not one of iTouching's"; an invented one says the opposite, and
 * these lists are exactly where somebody is deciding whether a name matches.
 */
export function StopCodeDot({ name, className }: { name: string | null | undefined; className?: string }) {
  const hue = stopColour(name);
  if (!hue) return null;
  const ambiguous = isAmbiguousStop(name);
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-0.5", className)}
      title={
        ambiguous
          ? "iTouching holds two codes called Metal Detected, in two colours; they cannot be told apart from here"
          : `iTouching paints this ${hue}`
      }
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hue }} aria-hidden />
      {ambiguous && <span className="text-2xs leading-none text-muted-foreground">*</span>}
    </span>
  );
}

export default StopCodeDot;
