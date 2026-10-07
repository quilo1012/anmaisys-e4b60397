import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Scale, Loader2 } from "lucide-react";
import { useOvertimeRules, useOvertimeMutations } from "@/hooks/useOvertimeRequests";

/**
 * Two rules, both off until somebody here turns them on.
 *
 * Written as numbers rather than as a policy page, because a rule the floor can read
 * in one line is a rule they can hold the supervisor to — "no-shows are out for 14
 * days" survives a shift change; "the supervisor decides" does not. Zero is off, and
 * off is the default: nothing changes on the floor until a manager says so here.
 */
export function OvertimeRulesDialog() {
  const { data: rules } = useOvertimeRules();
  const { saveRules } = useOvertimeMutations();
  const [open, setOpen] = useState(false);
  const [blockDays, setBlockDays] = useState("0");
  const [lateHours, setLateHours] = useState("0");
  const [lateBlocks, setLateBlocks] = useState(false);

  useEffect(() => {
    if (!rules) return;
    setBlockDays(String(rules.no_show_block_days));
    setLateHours(String(rules.late_cancel_hours));
    setLateBlocks(rules.late_cancel_blocks);
  }, [rules, open]);

  const submit = () => {
    const days = Number(blockDays), hours = Number(lateHours);
    if (!Number.isInteger(days) || days < 0 || days > 365) { toast.error("Block days: a whole number from 0 to 365."); return; }
    if (!Number.isInteger(hours) || hours < 0 || hours > 168) { toast.error("Late-cancel hours: a whole number from 0 to 168."); return; }
    saveRules.mutate(
      { no_show_block_days: days, late_cancel_hours: hours, late_cancel_blocks: lateBlocks },
      { onSuccess: () => { toast.success("Overtime rules saved"); setOpen(false); },
        onError: (e) => toast.error((e as Error).message) },
    );
  };

  const anyOn = (rules?.no_show_block_days ?? 0) > 0 || (rules?.late_cancel_hours ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Rules for no-shows and late cancellations">
          <Scale className="mr-1 h-4 w-4" /> Rules{anyOn ? " · on" : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Overtime rules</DialogTitle>
          <DialogDescription>Both are off at zero. Turn one on and it applies from the next outcome you record.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-1.5">
            <Label htmlFor="rule-block">After a no-show, no sign-up for</Label>
            <div className="flex items-center gap-2">
              <Input id="rule-block" type="number" min={0} max={365} inputMode="numeric" className="w-24" value={blockDays} onChange={(e) => setBlockDays(e.target.value)} />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
            <p className="text-xs text-muted-foreground">
              The person sees why on their screen and can't say yes until the date. You can still add them at the desk.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-late">Cancelling counts as late if under</Label>
            <div className="flex items-center gap-2">
              <Input id="rule-late" type="number" min={0} max={168} inputMode="numeric" className="w-24" value={lateHours} onChange={(e) => setLateHours(e.target.value)} />
              <span className="text-sm text-muted-foreground">hours before the shift</span>
            </div>
            <p className="text-xs text-muted-foreground">
              You record "Cancelled"; the clock decides. Late cancellations show as absences beside the name.
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <Label className="text-sm">A late cancellation also blocks sign-up</Label>
              <p className="text-xs text-muted-foreground">Same block as a no-show. Off means it only counts beside the name.</p>
            </div>
            <Switch checked={lateBlocks} onCheckedChange={setLateBlocks} disabled={Number(blockDays) <= 0} />
          </div>
          <Button onClick={submit} disabled={saveRules.isPending}>
            {saveRules.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save rules
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
