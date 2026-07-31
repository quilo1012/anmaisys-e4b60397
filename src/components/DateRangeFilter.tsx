import { useEffect, useState } from "react";
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth } from "date-fns";
import { CalendarIcon, Check, ChevronDown } from "lucide-react";
import { getCurrentFactoryShift, londonWallToUtc } from "@/lib/shifts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  // "Last" rather than a bare number: "7 days" reads as a duration, and somebody
  // choosing it wants the week behind them, not any seven days.
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  all: "All time",
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
  const presetLabel = preset === "custom"
    ? "Custom"
    : PRESET_LABELS[preset as Exclude<DateRangePreset, "custom">];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* One control, not eight.
            Today, Yesterday, Current shift, 7 days, 30 days, This month, All and
            Custom were eight things to read before choosing one, and the row wrapped
            on anything narrower than a desktop. The button says what is selected; the
            choosing happens when somebody asks for it. */}
        <Button
          variant="outline"
          className={cn("h-9 justify-start gap-2 font-normal", className)}
          aria-label="Period"
        >
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{presetLabel}</span>
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          {/* The presets read as a list, in the order somebody actually reaches for
              them: today's work first, then the periods a report covers. */}
          <div className="flex min-w-[11rem] flex-col gap-0.5 border-b p-2 sm:border-b-0 sm:border-r">
            {quick.map((p) => {
              const active = preset === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => { setPreset(p); setOpen(false); }}
                  className={cn(
                    "flex h-9 items-center justify-between rounded-md px-2.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  {PRESET_LABELS[p as Exclude<DateRangePreset, "custom">]}
                  {active && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>

          <div className="p-2">
            <p className="px-1 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Custom range
            </p>
            <Calendar
              mode="range"
              numberOfMonths={device === "desktop" ? 2 : 1}
              defaultMonth={value.from ?? new Date()}
              selected={{ from: value.from, to: value.to }}
              onSelect={(r) => {
                const from = r?.from ? startOfDay(r.from) : undefined;
                const to = r?.to ? endOfDay(r.to) : r?.from ? endOfDay(r.from) : undefined;
                onChange({ from, to }, "custom");
                // Only close once both ends are chosen — closing on the first click
                // made picking a range impossible.
                if (from && to) setOpen(false);
              }}
              initialFocus
              className="pointer-events-auto p-0"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
