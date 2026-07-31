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
  // The desktop segmented control and the tablet select each own a calendar, so they
  // need their own open state — one shared flag opened both at once.
  const [openMobile, setOpenMobile] = useState(false);
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
      {/* One segmented control, not seven loose buttons.
          The shift filter beside it is already a segmented group — border, muted
          well, padded pills — and two controls doing the same job in two visual
          languages is what made this toolbar look unfinished. Same container, same
          height, so they read as a pair. */}
      <div
        role="group"
        aria-label="Period"
        className="hidden md:inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1 shadow-sm"
      >
        {quick.map((p) => {
          const active = preset === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-all",
                active
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
              )}
            >
              {PRESET_LABELS[p as Exclude<DateRangePreset, "custom">]}
            </button>
          );
        })}

        {/* Custom sits inside the same well, behind a divider: it is one of the
            choices, not a separate control that happens to be next to them. */}
        <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-pressed={preset === "custom"}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-all",
                preset === "custom"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:bg-background/80 hover:text-foreground",
              )}
            >
              <CalendarIcon className="h-4 w-4" />
              {preset === "custom" ? label : "Custom"}
              {preset === "custom" && <Check className="h-3 w-3 opacity-80" />}
            </button>
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
      </div>

      {/* Below md the same choices are one select: seven buttons wrapped onto three
          rows on a line tablet and pushed the actual content off the screen. */}
      <div className="flex items-center gap-2 md:hidden">
        <Select
          value={preset === "custom" ? "custom" : preset}
          onValueChange={(p) => { if (p !== "custom") setPreset(p as DateRangePreset); }}
        >
          <SelectTrigger className="h-9 w-[150px]" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {quick.map((p) => (
              <SelectItem key={p} value={p}>{PRESET_LABELS[p as Exclude<DateRangePreset, "custom">]}</SelectItem>
            ))}
            {/* Present so the trigger has something to show when a custom range is
                active; picking it is a no-op — the calendar sets it. */}
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>

        <Popover open={openMobile} onOpenChange={setOpenMobile}>
          <PopoverTrigger asChild>
            <Button variant={preset === "custom" ? "default" : "outline"} size="sm" className="h-9 gap-1.5">
              <CalendarIcon className="h-4 w-4" />
              {preset === "custom" ? label : "Custom"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              numberOfMonths={1}
              defaultMonth={value.from ?? new Date()}
              selected={{ from: value.from, to: value.to }}
              onSelect={(r) => {
                const from = r?.from ? startOfDay(r.from) : undefined;
                const to = r?.to ? endOfDay(r.to) : r?.from ? endOfDay(r.from) : undefined;
                onChange({ from, to }, "custom");
                if (from && to) setOpenMobile(false);
              }}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* The resolved dates, once, quietly. The buttons say which preset; this says
          what it actually resolved to — and on a report that distinction matters. */}
      <span className="hidden md:inline text-xs tabular-nums text-muted-foreground">{label}</span>
    </div>
  );
}
