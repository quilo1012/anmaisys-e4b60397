import { cn } from "@/lib/utils";
import {
  DateRangeFilter,
  DateRangePreset,
  DateRange,
} from "@/components/DateRangeFilter";
import { ShiftFilter, ShiftValue } from "@/components/ShiftFilter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLines } from "@/hooks/useMachines";

export interface ReportsFilterBarProps {
  /** Date range value + preset (required) */
  dateRange: DateRange;
  datePreset: DateRangePreset;
  onDateChange: (range: DateRange, preset: DateRangePreset) => void;
  /** Optional shift filter — omit to hide */
  shift?: ShiftValue;
  onShiftChange?: (v: ShiftValue) => void;
  /** Optional line filter — omit to hide. Value = line_id or "ALL" */
  lineId?: string;
  onLineChange?: (v: string) => void;
  /** Persist date range to localStorage under this key (per page) */
  storageKey?: string;
  className?: string;
  /** Extra trailing content (badges, buttons) */
  children?: React.ReactNode;
}

export function ReportsFilterBar({
  dateRange,
  datePreset,
  onDateChange,
  shift,
  onShiftChange,
  lineId,
  onLineChange,
  storageKey,
  className,
  children,
}: ReportsFilterBarProps) {
  const { data: lines } = useLines();
  const showLine = typeof lineId !== "undefined" && !!onLineChange;
  const showShift = typeof shift !== "undefined" && !!onShiftChange;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 print:hidden",
        className,
      )}
    >
      <DateRangeFilter
        value={dateRange}
        preset={datePreset}
        onChange={onDateChange}
        storageKey={storageKey}
      />
      {showShift && <ShiftFilter value={shift!} onChange={onShiftChange!} />}
      {showLine && (
        <Select value={lineId!} onValueChange={onLineChange!}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="All lines" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All lines</SelectItem>
            {(lines ?? []).map((l: any) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}
