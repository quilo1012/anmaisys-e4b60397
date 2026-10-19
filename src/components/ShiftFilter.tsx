import { cn } from "@/lib/utils";

export type ShiftValue = "ALL" | "DAY" | "NIGHT";

interface ShiftFilterProps {
  value: ShiftValue;
  onChange: (v: ShiftValue) => void;
  className?: string;
  /**
   * Stretch across the row and always say the words. On a phone the default form is
   * three emoji in a 150px box — 🌗 ☀️ 🌙 — and "which one is All?" is a fair question.
   */
  fill?: boolean;
}

const OPTIONS: { value: ShiftValue; label: string; emoji: string; hint: string; ring: string }[] = [
  { value: "ALL", label: "All", emoji: "🌗", hint: "All shifts", ring: "data-[active=true]:bg-primary data-[active=true]:text-primary-foreground" },
  { value: "DAY", label: "Day", emoji: "☀️", hint: "06–18", ring: "data-[active=true]:bg-warning data-[active=true]:text-warning-foreground" },
  { value: "NIGHT", label: "Night", emoji: "🌙", hint: "18–06", ring: "data-[active=true]:bg-primary data-[active=true]:text-primary-foreground" },
];

export function ShiftFilter({ value, onChange, className, fill = false }: ShiftFilterProps) {
  return (
    <div
      role="group"
      aria-label="Shift filter"
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1 shadow-sm",
        fill && "flex w-full",
        className
      )}
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            data-active={active}
            onClick={() => onChange(opt.value)}
            title={opt.hint}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 h-9 text-sm font-medium transition-all",
              "hover:bg-background/80",
              opt.ring,
              fill && "flex-1 justify-center whitespace-nowrap px-2 [overflow-wrap:normal]",
              active && "shadow-md scale-[1.02]"
            )}
          >
            <span className={cn("text-base leading-none", fill && "hidden xs:inline")}>{opt.emoji}</span>
            <span className={fill ? "inline" : "hidden sm:inline"}>{opt.label}</span>
            <span className={cn("hidden text-2xs opacity-70", fill ? "xl:inline" : "md:inline", active && "opacity-90")}>
              {opt.hint !== opt.label ? opt.hint : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function filterByShift<T>(items: T[], shift: ShiftValue, getDate: (item: T) => string | Date | null | undefined): T[] {
  if (shift === "ALL") return items;
  return items.filter((it) => {
    const d = getDate(it);
    if (!d) return false;
    const date = new Date(d);
    const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/London" }).format(date));
    const isDay = h >= 6 && h < 18;
    return shift === "DAY" ? isDay : !isDay;
  });
}
