import { useMemo } from "react";
import { Bell, BellOff, Filter, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLines } from "@/hooks/useMachines";
import { useEngineerLineFilter } from "@/hooks/useEngineerLineFilter";

/**
 * Compact popover that lets an engineer choose which production lines should
 * trigger the critical siren on this device. Stored per-user in localStorage
 * (see useEngineerLineFilter). When nothing is selected the engineer monitors
 * every line — that's the safe default for new accounts.
 */
export function EngineerAlertLineFilter() {
  const { data: lines } = useLines();
  const {
    selectedLineIds,
    toggleLine,
    clearSelection,
    isFilteringActive,
  } = useEngineerLineFilter();

  const sortedLines = useMemo(
    () => (lines ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [lines]
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {isFilteringActive ? (
            <Filter className="h-4 w-4 text-primary" />
          ) : (
            <Bell className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">Alert lines</span>
          {isFilteringActive ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {selectedLineIds.length}
            </Badge>
          ) : (
            <Badge variant="outline" className="h-5 px-1.5 text-xs">
              All
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b px-3 py-2">
          <div className="text-sm font-semibold">Critical alert filter</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose which lines should trigger the siren on this device. Leave
            empty to monitor every line.
          </p>
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {sortedLines.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No production lines configured.
            </p>
          ) : (
            <div className="space-y-1">
              {sortedLines.map((line) => {
                const checked = selectedLineIds.includes(line.id);
                return (
                  <Label
                    key={line.id}
                    htmlFor={`alert-line-${line.id}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    <Checkbox
                      id={`alert-line-${line.id}`}
                      checked={checked}
                      onCheckedChange={() => toggleLine(line.id)}
                    />
                    <span className="flex-1 text-sm">{line.name}</span>
                    {checked && <Check className="h-3.5 w-3.5 text-primary" />}
                  </Label>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {isFilteringActive
              ? `Filtering ${selectedLineIds.length} line(s)`
              : "Monitoring all lines"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={clearSelection}
            disabled={!isFilteringActive}
          >
            <BellOff className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
