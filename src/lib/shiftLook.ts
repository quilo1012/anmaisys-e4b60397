import { cn } from "@/lib/utils";

export type ShiftKind = "day" | "night";

/**
 * Day or Night from whatever the row carries: the board's "Day"/"Night", a crew
 * name, an `OvertimeShift`, a `ShiftCode`. Anything else — "Weekend", a blank —
 * is null, and the caller shows its own text instead of guessing a colour.
 */
export function shiftKind(value: string | null | undefined): ShiftKind | null {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "day" || v === "days") return "day";
  if (v === "night" || v === "nights") return "night";
  return null;
}

export const SHIFT_LOOK: Record<ShiftKind, { word: string; pill: string; edge: string }> = {
  day: {
    word: "Day",
    pill: "border-shift-day/40 bg-shift-day/10 text-shift-day-strong",
    edge: "border-l-shift-day",
  },
  night: {
    word: "Night",
    pill: "border-shift-night/40 bg-shift-night/10 text-shift-night-strong",
    edge: "border-l-shift-night",
  },
};

/**
 * A coloured left edge for a card or a row that belongs to one shift. Pair it with
 * a `ShiftTag` inside: the edge is for the eye scanning a list, the tag is what says it.
 */
export function shiftEdge(value: string | null | undefined): string {
  const k = shiftKind(value);
  return k ? cn("border-l-4", SHIFT_LOOK[k].edge) : "";
}
