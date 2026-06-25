import { cn } from "@/lib/utils";

export type ShiftValue = "ALL" | "DAY" | "NIGHT";

interface ShiftFilterProps {
  value: ShiftValue;
  onChange: (v: ShiftValue) => void;
  className?: string;
}

const OPTIONS: { value: ShiftValue; label: string; emoji: string; hint: string; ring: string }[] = [
  { value: "ALL", label: "All", emoji: "🌗", hint: "All shifts", ring: "data-[active=true]:bg-primary data-[active=true]:text-primary-foreground" },
  { value: "DAY", label: "Day", emoji: "☀️", hint: "06–18", ring: "data-[active=true]:bg-amber-500 data-[active=true]:text-white" },
  { value: "NIGHT", label: "Night", emoji: "🌙", hint: "18–06", ring: "data-[active=true]:bg-indigo-600 data-[active=true]:text-white" },
];

export function ShiftFilter({ value, onChange, className }: ShiftFilterProps) {
  return (
    <div
      role="group"
      aria-label="Shift filter"
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1 shadow-sm",
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
              active && "shadow-md scale-[1.02]"
            )}
          >
            <span className="text-base leading-none">{opt.emoji}</span>
            <span className="hidden sm:inline">{opt.label}</span>
            <span className={cn("hidden md:inline text-[10px] opacity-70", active && "opacity-90")}>
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
