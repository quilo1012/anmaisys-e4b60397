import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { shiftKind, SHIFT_LOOK } from "@/lib/shiftLook";

/**
 * "☀ Day shift" / "☾ Night shift" — icon, word and colour together, so it still
 * reads in greyscale, on paper, and to someone who cannot tell the two hues apart.
 * Small on purpose: it sits inside a line of text, not above it.
 */
export function ShiftTag({
  shift, noun = "shift", className,
}: { shift: string | null | undefined; noun?: "shift" | "crew"; className?: string }) {
  const k = shiftKind(shift);
  if (!k) return shift ? <span className={cn("text-xs text-muted-foreground", className)}>{shift}</span> : null;
  const Icon = k === "day" ? Sun : Moon;
  const { word, pill } = SHIFT_LOOK[k];
  return (
    <span
      data-shift={k}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold leading-none",
        pill, className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {word} {noun}
    </span>
  );
}
