import { useMemo, useState } from "react";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleStripe } from "@/lib/workforceRoles";
import type { Employee } from "@/hooks/useWorkforce";

export interface PickerPerson extends Employee {
  /** The area they are in on the day being shown, resolved by the caller. */
  currentAreaId: string | null;
  currentAreaName: string | null;
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
export function AreaPicker({
  areaId, areaName, people, open, onOpenChange, onToggle,
}: {
  areaId: string;
  areaName: string;
  people: PickerPerson[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the target area, or null to take them off this one. */
  onToggle: (person: PickerPerson, toAreaId: string | null) => void;
}) {
  const [query, setQuery] = useState("");

  const { here, elsewhere } = useMemo(() => {
    const here: PickerPerson[] = [];
    const elsewhere: PickerPerson[] = [];
    for (const p of people) (p.currentAreaId === areaId ? here : elsewhere).push(p);
    const byName = (a: PickerPerson, b: PickerPerson) => a.full_name.localeCompare(b.full_name);
    return { here: here.sort(byName), elsewhere: elsewhere.sort(byName) };
  }, [people, areaId]);

  const row = (p: PickerPerson, isHere: boolean) => {
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
            {here.length} on this area today. Search anyone on this shift and pick them to
            move them here; pick somebody already here to take them off.
          </DialogDescription>
        </DialogHeader>
        <Command shouldFilter className="rounded-none border-t">
          <CommandInput placeholder="Search name…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[22rem]">
            <CommandEmpty>Nobody on this shift matches that.</CommandEmpty>
            {here.length > 0 && (
              <CommandGroup heading={`On ${areaName}`}>{here.map((p) => row(p, true))}</CommandGroup>
            )}
            {elsewhere.length > 0 && (
              <CommandGroup heading="Elsewhere on this shift">
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
