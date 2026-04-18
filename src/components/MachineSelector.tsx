import { useMemo, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useMachines, useLines, type Machine, type MachineSide } from "@/hooks/useMachines";
import { cn } from "@/lib/utils";

interface Props {
  lineId: string;
  side: MachineSide | "";
  machineName: string;
  onChange: (next: { lineId: string; side: MachineSide | ""; machineName: string }) => void;
}

const sideBadgeClass = (s: MachineSide | string) =>
  s === "A" ? "bg-blue-100 text-blue-800 border-blue-200"
  : s === "B" ? "bg-orange-100 text-orange-800 border-orange-200"
  : "bg-slate-100 text-slate-700 border-slate-200";

export function MachineSelector({ lineId, side, machineName, onChange }: Props) {
  const { data: lines } = useLines();
  const { data: machines } = useMachines();

  const selectedLine = useMemo(() => lines?.find((l) => l.id === lineId), [lines, lineId]);
  const lineHasSides = !!selectedLine?.has_sides;

  // If line changes and new line has no sides, force side to "" and rely on common machines.
  useEffect(() => {
    if (selectedLine && !selectedLine.has_sides && side !== "") {
      onChange({ lineId, side: "", machineName: "" });
    }
  }, [selectedLine?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredMachines = useMemo(() => {
    if (!machines || !selectedLine) return [];
    return machines.filter((m) => {
      if (m.line_id !== selectedLine.id) return false;
      if (!lineHasSides) return true;
      // Side selected: include common always, plus the chosen side
      if (side === "A") return m.side === "A" || m.side === "common";
      if (side === "B") return m.side === "B" || m.side === "common";
      // No side selected yet → show none until user picks
      return false;
    });
  }, [machines, selectedLine, lineHasSides, side]);

  const grouped = useMemo(() => {
    const map = new Map<string, Machine[]>();
    filteredMachines.forEach((m) => {
      const key = m.machine_type?.trim() || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredMachines]);

  return (
    <div className="space-y-4">
      {/* Step 1 — Line */}
      <div className="space-y-2">
        <Label>Line *</Label>
        <Select
          value={lineId}
          onValueChange={(v) => onChange({ lineId: v, side: "", machineName: "" })}
        >
          <SelectTrigger><SelectValue placeholder="Select line..." /></SelectTrigger>
          <SelectContent>
            {(lines || []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}{l.has_sides ? " (A/B)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Step 2 — Side (only if line has sides) */}
      {lineHasSides && (
        <div className="space-y-2">
          <Label>Which side of {selectedLine?.name}? *</Label>
          <div className="grid grid-cols-3 gap-2">
            {(["A", "B", "common"] as const).map((s) => (
              <Button
                key={s}
                type="button"
                variant={side === s ? "default" : "outline"}
                className={cn("h-14 text-base", side === s && "ring-2 ring-primary")}
                onClick={() => onChange({ lineId, side: s, machineName: "" })}
              >
                {s === "common" ? "Not sure / Shared" : `Side ${s}`}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Step 3 — Machine grouped by type */}
      {selectedLine && (!lineHasSides || side !== "") && (
        <div className="space-y-2">
          <Label>Machine *</Label>
          <Select value={machineName} onValueChange={(v) => onChange({ lineId, side, machineName: v })}>
            <SelectTrigger><SelectValue placeholder="Select machine..." /></SelectTrigger>
            <SelectContent>
              {grouped.length === 0 && (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  No machines for this selection.
                </div>
              )}
              {grouped.map(([type, items]) => (
                <SelectGroup key={type}>
                  <SelectLabel>{type}</SelectLabel>
                  {items.map((m) => (
                    <SelectItem key={m.id} value={m.name}>
                      <span className="inline-flex items-center gap-2">
                        {m.name}
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", sideBadgeClass(m.side))}>
                          {m.side === "common" ? "Shared" : m.side}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export function SideBadge({ side, className }: { side: MachineSide | string; className?: string }) {
  if (!side) return null;
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", sideBadgeClass(side), className)}>
      {side === "common" ? "Shared" : `Side ${side}`}
    </Badge>
  );
}
