import { useEffect, useState } from "react";
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth } from "date-fns";
import { CalendarIcon, Check } from "lucide-react";
import { getCurrentFactoryShift, londonWallToUtc } from "@/lib/shifts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDeviceType } from "@/hooks/use-device-type";

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
  // DAY 06–18, NIGHT 18–06, on London time from end to end.
  //
  // This used the browser's local hour AND built the boundary with setHours, so on a
  // device in another timezone both the branch and the 06:00/18:00 edge were wrong,
  // silently: at 15:00 local on a device two hours ahead, "Current shift" meant the
  // night one and started at the wrong instant. Every other shift calculation in the
  // system — getCurrentFactoryShift, session_write_deadline, the shift filters — is
  // London-based, so this one disagreed with all of them.
  //
  // getCurrentFactoryShift decides which shift is running and londonWallToUtc turns
  // a London wall-clock hour into a real instant, both already used by the rest of
  // the system.
  const { sessionDate, shiftCode } = getCurrentFactoryShift(now);
  const [y, mo, d] = sessionDate.split("-").map(Number);
  const from = new Date(londonWallToUtc(y, mo, d, shiftCode === "night" ? 18 : 6));
  return { from, to: now };
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
  const device = useDeviceType();

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
      {/* Seven buttons is right on a desktop report and wrong on a line tablet, where
          they wrapped onto three rows and pushed the actual content off the screen.
          Below md the same choices are one select. */}
      <div className="hidden md:flex flex-wrap gap-1">
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

      <Select
        value={preset === "custom" ? "custom" : preset}
        onValueChange={(p) => { if (p !== "custom") setPreset(p as DateRangePreset); }}
      >
        <SelectTrigger className="h-9 w-[150px] md:hidden" aria-label="Period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {quick.map((p) => (
            <SelectItem key={p} value={p}>{PRESET_LABELS[p as Exclude<DateRangePreset, "custom">]}</SelectItem>
          ))}
          {/* Present so the trigger has something to show when a custom range is
              active; picking it is a no-op — the calendar below sets it. */}
          <SelectItem value="custom">Custom</SelectItem>
        </SelectContent>
      </Select>

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
          {/* One month below desktop: two side by side are wider than a phone, so the
              popover clipped the second and its days could not be tapped. */}
          <Calendar
            mode="range"
            numberOfMonths={device === "desktop" ? 2 : 1}
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

      {/* The select and the Custom button already say the period on small screens. */}
      <span className="hidden md:inline text-xs text-muted-foreground ml-1">{label}</span>
    </div>
  );
}
