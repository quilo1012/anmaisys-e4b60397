import { useState } from "react";
import { format, startOfDay, subDays } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DateRange = { from?: Date; to?: Date };

export type DateRangePreset = "today" | "7d" | "30d" | "all" | "custom";

export function getPresetRange(preset: DateRangePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: now };
    case "7d":
      return { from: startOfDay(subDays(now, 6)), to: now };
    case "30d":
      return { from: startOfDay(subDays(now, 29)), to: now };
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
}

export function DateRangeFilter({ value, preset, onChange, className }: Props) {
  const [openFrom, setOpenFrom] = useState(false);
  const [openTo, setOpenTo] = useState(false);

  const setPreset = (p: DateRangePreset) => {
    onChange(getPresetRange(p), p);
  };

  const label =
    !value.from && !value.to
      ? "All time"
      : `${value.from ? format(value.from, "dd/MM/yy") : "…"} – ${value.to ? format(value.to, "dd/MM/yy") : "…"}`;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex gap-1">
        <Button size="sm" variant={preset === "today" ? "default" : "outline"} onClick={() => setPreset("today")}>Today</Button>
        <Button size="sm" variant={preset === "7d" ? "default" : "outline"} onClick={() => setPreset("7d")}>7 days</Button>
        <Button size="sm" variant={preset === "30d" ? "default" : "outline"} onClick={() => setPreset("30d")}>30 days</Button>
        <Button size="sm" variant={preset === "all" ? "default" : "outline"} onClick={() => setPreset("all")}>All</Button>
      </div>

      <div className="flex items-center gap-1">
        <Popover open={openFrom} onOpenChange={setOpenFrom}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("justify-start gap-2", !value.from && "text-muted-foreground")}>
              <CalendarIcon className="h-4 w-4" />
              {value.from ? format(value.from, "dd/MM/yy") : "From"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={value.from}
              onSelect={(d) => {
                onChange({ from: d ? startOfDay(d) : undefined, to: value.to }, "custom");
                setOpenFrom(false);
              }}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        <span className="text-muted-foreground text-sm">–</span>

        <Popover open={openTo} onOpenChange={setOpenTo}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("justify-start gap-2", !value.to && "text-muted-foreground")}>
              <CalendarIcon className="h-4 w-4" />
              {value.to ? format(value.to, "dd/MM/yy") : "To"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={value.to}
              onSelect={(d) => {
                onChange({ from: value.from, to: d ?? undefined }, "custom");
                setOpenTo(false);
              }}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      </div>

      <span className="text-xs text-muted-foreground ml-1">{label}</span>
    </div>
  );
}
