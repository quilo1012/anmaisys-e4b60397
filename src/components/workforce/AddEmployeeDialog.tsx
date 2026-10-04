import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEPARTMENTS } from "@/lib/orgNames";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { AlertTriangle, UserPlus } from "lucide-react";
import { useCreateEmployee, useEmployees, useHeadcountAreas } from "@/hooks/useWorkforce";
import { similarNames } from "@/lib/similarNames";

const SHIFT_GROUPS = ["Day", "Night", "Weekend", "Warehouse Day", "Warehouse Weekend"];

/**
 * Add somebody who started this morning.
 *
 * Name and shift are the only things required, because they are the only things
 * somebody standing on the floor reliably knows. The start date is left blank rather
 * than defaulted to today: today's date is a guess that gets believed later.
 *
 * The name is checked against the record before it can be saved. FELIPE DE ARAUJO
 * and FELIPE ARAUJO are both on the books, both Night, both started 30/06, and both
 * one man: 37 placements on one row and 7 on the other, so the headcount counts him
 * twice and his holiday balance is split across two rows of the Leave screen. This
 * screen is where the second one was typed, and nothing here asked.
 *
 * No payroll number here. The E-numbers came from the payroll list and belong to it;
 * typing one on this screen would be inventing a key that has to match another
 * system, and a wrong one is worse than none. HR fills it in from the record.
 */
export function AddEmployeeDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shift, setShift] = useState("Day");
  const [area, setArea] = useState("__none__");
  const [department, setDepartment] = useState("");
  const [startedOn, setStartedOn] = useState("");
  /** Ticked by a human to say the lookalike below is somebody else. */
  const [notTheSame, setNotTheSame] = useState(false);

  const { data: areas } = useHeadcountAreas();
  // Leavers included: somebody coming back is a record to reopen, with their
  // attendance and their overtime balance already on it.
  const { data: onFile = [] } = useEmployees();
  const create = useCreateEmployee();

  const trimmed = name.trim();

  const lookalikes = useMemo(() => similarNames(trimmed, onFile).slice(0, 4), [trimmed, onFile]);
  const blocked = lookalikes.length > 0 && !notTheSame;

  const reset = () => {
    setName(""); setShift("Day"); setArea("__none__");
    setDepartment(""); setStartedOn(""); setNotTheSame(false);
  };

  const submit = () => {
    create.mutate(
      {
        full_name: trimmed,
        shift_group: shift,
        department: department.trim() || null,
        headcount_area_id: area === "__none__" ? null : area,
        started_on: startedOn || null,
      },
      {
        onSuccess: () => {
          toast.success(`${trimmed} added to the ${shift} shift`);
          reset();
          setOpen(false);
        },
        onError: (e) => toast.error((e as Error).message || "Could not add"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="no-print">
          <UserPlus className="mr-1 h-4 w-4" /> Add employee
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add employee</DialogTitle>
          <DialogDescription>
            Name and shift are enough to get somebody onto today's board. The rest can
            be filled in from their paperwork later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div>
            <Label className="text-xs" htmlFor="ae-name">Full name</Label>
            <Input
              id="ae-name"
              value={name}
              autoFocus
              placeholder="Name and surname"
              onChange={(e) => { setName(e.target.value); setNotTheSame(false); }}
            />
            {/* A warning, never a refusal: two brothers on the same line is a real
                thing here. It says who is already on file and makes somebody say
                out loud that this is not them. */}
            {lookalikes.length > 0 && (
              <div className="mt-2 rounded-md border border-warning/40 bg-warning/5 p-2.5">
                <p className="flex items-start gap-1.5 text-2xs font-medium text-warning-strong">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  {lookalikes[0].strength === "same"
                    ? "This name is already on the record."
                    : "This looks like somebody already on the record."}
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {lookalikes.map((m) => (
                    <li key={m.id} className="text-2xs">
                      <span className="font-medium">{m.full_name}</span>
                      <span className="text-muted-foreground">
                        {m.shift_group ? ` · ${m.shift_group}` : ""}
                        {m.department ? ` · ${m.department}` : ""}
                        {m.active ? "" : m.left_on ? ` · left ${m.left_on}` : " · left"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  Adding a second row for the same person splits their attendance,
                  their holiday balance and their overtime between the two.
                </p>
                <label className="mt-2 flex items-center gap-2 text-2xs">
                  <Checkbox checked={notTheSame} onCheckedChange={(v) => setNotTheSame(v === true)} />
                  This is a different person
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Shift</Label>
              <Select value={shift} onValueChange={setShift}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHIFT_GROUPS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Usual area</Label>
              <Select value={area} onValueChange={setArea}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— none yet —</SelectItem>
                  {(areas ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Department</Label>
              {/* Same seven the board uses. A new starter typed in freehand is how the
                  fifteen-name mess started. */}
              <Select value={department || "__none__"} onValueChange={(v) => setDepartment(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not set</SelectItem>
                  {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs" htmlFor="ae-start">Start date</Label>
            <Input id="ae-start" type="date" value={startedOn}
                   onChange={(e) => setStartedOn(e.target.value)} />
            <p className="mt-1 text-2xs text-muted-foreground">
              Leave blank if you do not know it. Blank reads as unrecorded; today's date
              would read as a fact.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!trimmed || blocked || create.isPending}>
            {create.isPending ? "Adding…" : lookalikes.length > 0 ? "Add anyway" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddEmployeeDialog;
