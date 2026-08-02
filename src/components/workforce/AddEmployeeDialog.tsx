import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { useCreateEmployee, useHeadcountAreas } from "@/hooks/useWorkforce";

const SHIFT_GROUPS = ["Day", "Night", "Weekend", "Warehouse Day", "Warehouse Weekend"];

/**
 * Add somebody who started this morning.
 *
 * Name and shift are the only things required, because they are the only things
 * somebody standing on the floor reliably knows. The payroll number and the start
 * date are optional and left blank rather than defaulted: a made-up employee number
 * matches nothing in payroll, and today's date as a start date is a guess that will
 * be believed later.
 */
export function AddEmployeeDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shift, setShift] = useState("Day");
  const [area, setArea] = useState("__none__");
  const [department, setDepartment] = useState("");
  const [ref, setRef] = useState("");
  const [startedOn, setStartedOn] = useState("");

  const { data: areas } = useHeadcountAreas();
  const create = useCreateEmployee();

  const trimmed = name.trim();

  const reset = () => {
    setName(""); setShift("Day"); setArea("__none__");
    setDepartment(""); setRef(""); setStartedOn("");
  };

  const submit = () => {
    create.mutate(
      {
        full_name: trimmed,
        shift_group: shift,
        department: department.trim() || null,
        headcount_area_id: area === "__none__" ? null : area,
        employee_ref: ref.trim() || null,
        started_on: startedOn || null,
      },
      {
        onSuccess: () => {
          toast.success(`${trimmed} added to the ${shift} shift`);
          reset();
          setOpen(false);
        },
        onError: (e) => {
          const msg = (e as Error).message || "Could not add";
          // The payroll number is unique in the database, and a clash here almost
          // always means the person is already on the list under another spelling.
          toast.error(
            /duplicate key|unique/i.test(msg)
              ? `Payroll number ${ref.trim()} already belongs to somebody on the list`
              : msg,
          );
        },
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
              onChange={(e) => setName(e.target.value)}
            />
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
              <Label className="text-xs" htmlFor="ae-dept">Department</Label>
              <Input id="ae-dept" value={department} placeholder="Optional"
                     onChange={(e) => setDepartment(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs" htmlFor="ae-ref">Payroll number</Label>
              <Input id="ae-ref" value={ref} placeholder="Optional" className="font-mono"
                     onChange={(e) => setRef(e.target.value)} />
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
          <Button onClick={submit} disabled={!trimmed || create.isPending}>
            {create.isPending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AddEmployeeDialog;
