import { useMemo, useState } from "react";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleStripe } from "@/lib/workforceRoles";

/**
 * Only what the picker actually shows, so both boards can share it.
 *
 * It used to extend `Employee`, which tied it to the Workforce board's row shape and
 * meant the headcount board could not reuse it without carrying a dozen fields the
 * picker never reads.
 */
export interface PickerPerson {
  id: string;
  full_name: string;
  department: string | null;
  employee_ref?: string | null;
  /** The area they are in on the day being shown, resolved by the caller. */
  currentAreaId: string | null;
  currentAreaName: string | null;
  /** Their rota does not cover this day — placing them makes it an overtime day. */
  offRota?: boolean;
  /** They belong to another shift; placing them here is a call-in across crews. */
  otherShift?: string | null;
}

/**
 * Fill an area by searching, rather than by dragging sixty-eight cards.
 *
 * Everyone on the shift is listed, not only the unplaced ones, because moving
 * somebody from Line 2 to Line 1 is the same job as placing them and splitting it
 * across two interactions is what makes people give up and use the spreadsheet.
 * Anybody already here is pinned to the top with a tick, so the list doubles as the
 * answer to "who is on this line".
 */
export function AreaPicker<T extends PickerPerson>({
  areaId, areaName, people, open, onOpenChange, onToggle,
}: {
  areaId: string;
  areaName: string;
  people: T[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the target area, or null to take them off this one. */
  onToggle: (person: T, toAreaId: string | null) => void;
}) {
  const [query, setQuery] = useState("");

  const { here, elsewhere } = useMemo(() => {
    const here: T[] = [];
    const elsewhere: T[] = [];
    for (const p of people) (p.currentAreaId === areaId ? here : elsewhere).push(p);
    const byName = (a: T, b: T) => a.full_name.localeCompare(b.full_name);
    return { here: here.sort(byName), elsewhere: elsewhere.sort(byName) };
  }, [people, areaId]);

  const row = (p: T, isHere: boolean) => {
    const role = roleStripe(p.department);
    return (
      <CommandItem
        key={p.id}
        value={`${p.full_name} ${p.department ?? ""} ${p.employee_ref ?? ""}`}
        onSelect={() => onToggle(p, isHere ? null : areaId)}
        className="gap-2"
      >
        <span className={cn("flex h-4 w-4 items-center justify-center rounded-sm border", isHere && "border-primary bg-primary text-primary-foreground")}>
          {isHere && <Check className="h-3 w-3" />}
        </span>
        {role && (
          <span className={cn("rounded-sm px-1 py-px text-[9px] font-bold uppercase leading-tight", role.cls)}>
            {role.short}
          </span>
        )}
        <span className="flex-1 truncate">{p.full_name}</span>
        {/* Said before the choice, not after it: putting somebody on a line on a day
            their rota does not cover is a call-in, and the card will say OT day. */}
        {p.otherShift && (
          <span className="shrink-0 rounded border border-primary/50 bg-primary/15 px-1 py-px text-[9px] font-bold uppercase leading-tight text-primary">
            {p.otherShift}
          </span>
        )}
        {p.offRota && !p.otherShift && (
          <span className="shrink-0 rounded border border-warning/50 bg-warning/15 px-1 py-px text-[9px] font-bold uppercase leading-tight text-warning-strong">
            Off rota
          </span>
        )}
        {/* Where they are now, so nobody is moved off a line without seeing it. */}
        {!isHere && p.currentAreaName && (
          <span className="shrink-0 text-2xs text-muted-foreground">{p.currentAreaName}</span>
        )}
        {isHere && <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </CommandItem>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setQuery(""); }}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{areaName}</DialogTitle>
          <DialogDescription>
            {/* "on this area" reads wrong for Absence and Holidays, which are states
                rather than places. The caller says which it is by the id it passes. */}
            {here.length} {areaId.startsWith("away:") ? "on this list" : "on this area"} today.
            Everyone is listed — including people the rota does not put in today, and people
            from another shift. Pick them to move them here, or pick somebody already here to
            take them off.
          </DialogDescription>
        </DialogHeader>
        {/* Substring, not the fuzzy default. Typing "rich" was returning Gabriel
            Chimenez and Alexandre Da Silva Rocha — a scored match on scattered
            letters — while the person actually called Richrad was nowhere. A search
            that answers with names you did not ask for teaches people not to trust
            it. */}
        <Command
          className="rounded-none border-t"
          filter={(value, search) =>
            value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Search name…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[22rem]">
            <CommandEmpty>Nobody matches that.</CommandEmpty>
            {here.length > 0 && (
              <CommandGroup heading={`On ${areaName}`}>{here.map((p) => row(p, true))}</CommandGroup>
            )}
            {elsewhere.length > 0 && (
              <CommandGroup heading="Everyone else">
                {elsewhere.map((p) => row(p, false))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export default AreaPicker;
