import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveShiftHours, useShiftHours } from "@/hooks/useShiftHours";

const hh = (n: number) => `${String(n).padStart(2, "0")}:00`;

/** Factory Day/Night hours used by the Fill speed matrix and Line deviation. */
export default function ShiftHoursPage() {
  const { hours, active, isLoading, error } = useShiftHours();
  const save = useSaveShiftHours();
  const [start, setStart] = useState(hours.dayStart);
  const [end, setEnd] = useState(hours.dayEnd);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setStart(hours.dayStart); setEnd(hours.dayEnd); }, [hours.dayStart, hours.dayEnd]);
  const valid = start < end;
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader dense module="Production" title="Shift hours" description="The factory's real Day and Night hours, used to split batches by shift in the Fill speed matrix and Line deviation." icon={<Clock className="h-5 w-5" />} className="mb-0 border-b pb-3" />
        <Card className="max-w-xl">
          <CardHeader><CardTitle>Day shift (London time)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {error ? <p className="text-destructive">Could not load the shift hours.</p> : isLoading ? <p className="text-muted-foreground">Loading…</p> : (<>
              <div className="flex flex-wrap items-center gap-3">
                <Select value={String(start)} onValueChange={(v) => { setStart(Number(v)); setSaved(false); }}>
                  <SelectTrigger className="h-14 w-32" aria-label="Day shift starts"><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({ length: 24 }, (_, i) => <SelectItem key={i} value={String(i)}>{hh(i)}</SelectItem>)}</SelectContent>
                </Select>
                <span>to</span>
                <Select value={String(end)} onValueChange={(v) => { setEnd(Number(v)); setSaved(false); }}>
                  <SelectTrigger className="h-14 w-32" aria-label="Day shift ends"><SelectValue /></SelectTrigger>
                  <SelectContent>{Array.from({ length: 24 }, (_, i) => i + 1).map((i) => <SelectItem key={i} value={String(i)}>{hh(i)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <p className="text-sm text-muted-foreground">A batch that starts inside these hours counts as Day; any other start counts as Night ({hh(end)}–{hh(start)}).</p>
              {!valid && <p className="text-sm text-destructive">The Day shift must end after it starts.</p>}
              {!active && <p className="text-sm text-warning">Saving is not active yet: the shift hours table has not been added to the database. Until then 06:00–18:00 is used.</p>}
              {save.error && <p className="text-sm text-destructive">{save.error instanceof Error ? save.error.message : "Could not save."}</p>}
              {saved && !save.error && <p className="text-sm text-success">Saved for everyone.</p>}
              <Button className="h-14 px-6" disabled={!valid || !active || save.isPending} onClick={() => save.mutateAsync({ dayStart: start, dayEnd: end }).then(() => setSaved(true)).catch(() => setSaved(false))}>
                {save.isPending ? "Saving…" : "Save shift hours"}
              </Button>
            </>)}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
