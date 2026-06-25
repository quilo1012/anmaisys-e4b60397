import { useEffect, useState } from "react";
import {
  format,
  startOfDay,
  endOfDay,
  subDays,
  startOfMonth,
  endOfMonth,
  setHours,
  setMinutes,
  setSeconds,
} from "date-fns";
import { CalendarIcon, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DateRange = { from?: Date; to?: Date };

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "shift"
  | "7d"
  | "30d"
  | "month"
  | "all"
  | "custom";

const PRESET_LABELS: Record<Exclude<DateRangePreset, "custom">, string> = {
  today: "Today",
  yesterday: "Yesterday",
  shift: "Current shift",
  "7d": "7 days",
  "30d": "30 days",
  month: "This month",
  all: "All",
};

function currentShiftRange(now = new Date()): DateRange {
  // London-shift heuristic using local hour: DAY 06-18, NIGHT 18-06
  const h = now.getHours();
  if (h >= 6 && h < 18) {
    return { from: setSeconds(setMinutes(setHours(now, 6), 0), 0), to: now };
  }
  if (h >= 18) {
    return { from: setSeconds(setMinutes(setHours(now, 18), 0), 0), to: now };
  }
  // 00:00–05:59 → night shift started yesterday 18:00
  const y = subDays(now, 1);
  return { from: setSeconds(setMinutes(setHours(y, 18), 0), 0), to: now };
}

export function getPresetRange(preset: DateRangePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: now };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "shift":
      return currentShiftRange(now);
    case "7d":
      return { from: startOfDay(subDays(now, 6)), to: now };
    case "30d":
      return { from: startOfDay(subDays(now, 29)), to: now };
    case "month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "all":
      return {};
    default:
      return {};
  }
}

interface Props {
  value: DateRange;
  preset: DateRangePreset;
  onChange: (range: DateRange, preset: DateRangePreset) => void;
  className?: string;
  /** When set, persists the current preset+range to localStorage and restores on mount. */
  storageKey?: string;
}

export function DateRangeFilter({ value, preset, onChange, className, storageKey }: Props) {
  const [open, setOpen] = useState(false);

  // Restore from localStorage on mount
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(`dr:${storageKey}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { preset: DateRangePreset; from?: string; to?: string };
      if (parsed.preset && parsed.preset !== "custom") {
        onChange(getPresetRange(parsed.preset), parsed.preset);
      } else if (parsed.preset === "custom") {
        onChange(
          { from: parsed.from ? new Date(parsed.from) : undefined, to: parsed.to ? new Date(parsed.to) : undefined },
          "custom",
        );
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist on change
  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(
        `dr:${storageKey}`,
        JSON.stringify({
          preset,
          from: value.from?.toISOString(),
          to: value.to?.toISOString(),
        }),
      );
    } catch {
      /* ignore */
    }
  }, [storageKey, preset, value.from, value.to]);

  const setPreset = (p: DateRangePreset) => onChange(getPresetRange(p), p);

  const label =
    !value.from && !value.to
      ? "All time"
      : value.from && value.to && value.from.toDateString() === value.to.toDateString()
        ? format(value.from, "dd MMM yyyy")
        : `${value.from ? format(value.from, "dd/MM/yy") : "…"} – ${value.to ? format(value.to, "dd/MM/yy") : "…"}`;

  const quick: DateRangePreset[] = ["today", "yesterday", "shift", "7d", "30d", "month", "all"];

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex flex-wrap gap-1">
        {quick.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={preset === p ? "default" : "outline"}
            onClick={() => setPreset(p)}
          >
            {PRESET_LABELS[p as Exclude<DateRangePreset, "custom">]}
          </Button>
        ))}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={preset === "custom" ? "default" : "outline"}
            size="sm"
            className="justify-start gap-2"
          >
            <CalendarIcon className="h-4 w-4" />
            {preset === "custom" ? label : "Custom"}
            {preset === "custom" && <Check className="h-3 w-3 opacity-70" />}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={value.from ?? new Date()}
            selected={{ from: value.from, to: value.to }}
            onSelect={(r) => {
              const from = r?.from ? startOfDay(r.from) : undefined;
              const to = r?.to ? endOfDay(r.to) : r?.from ? endOfDay(r.from) : undefined;
              onChange({ from, to }, "custom");
              if (from && to) setOpen(false);
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>

      <span className="text-xs text-muted-foreground ml-1">{label}</span>
    </div>
  );
}
