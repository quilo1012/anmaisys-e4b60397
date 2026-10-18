import { cn } from "@/lib/utils";
import { Sun, Moon, Eclipse } from "lucide-react";
import { SHIFT_LOOK } from "@/lib/shiftLook";
import { Button } from "@/components/ui/button";

export type ShiftValue = "ALL" | "DAY" | "NIGHT";

interface ShiftFilterProps {
  value: ShiftValue;
  onChange: (v: ShiftValue) => void;
  className?: string;
}

const OPTIONS: { value: ShiftValue; label: string; icon: typeof Sun; hint: string; ring: string }[] = [
  { value: "ALL", label: "All", icon: Eclipse, hint: "All shifts", ring: "bg-primary text-primary-foreground" },
  { value: "DAY", label: "Day", icon: Sun, hint: "06–18", ring: SHIFT_LOOK.day.pill },
  { value: "NIGHT", label: "Night", icon: Moon, hint: "18–06 +1", ring: SHIFT_LOOK.night.pill },
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
        const Icon = opt.icon;
        return (
          <Button variant="ghost"
            key={opt.value}
            type="button"
            data-active={active}
            onClick={() => onChange(opt.value)}
            title={opt.hint}
            aria-label={opt.value === "ALL" ? "All shifts" : `${opt.label} shift`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 h-9 text-sm font-medium transition-all",
              "hover:bg-background/80",
              active && opt.ring,
              active && "shadow-md scale-[1.02]"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{opt.label}</span>
            <span className={cn("hidden md:inline text-2xs opacity-70", active && "opacity-90")}>
              {opt.hint !== opt.label ? opt.hint : ""}
            </span>
          </Button>
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
