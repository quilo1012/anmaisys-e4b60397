import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, UserPlus } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { useAssignWorkOrderEngineer, useEngineerList, type WorkOrder } from "@/hooks/useWorkOrders";
import { useToast } from "@/hooks/use-toast";

/**
 * Hand an order that nobody accepted to a named engineer.
 *
 * Assignment is not acceptance — the engineer still accepts and starts it, which is
 * what stamps the response time. This only gives the order an owner and puts it in
 * that engineer's alerts.
 */
export function AssignEngineerDialog({
  wo,
  open,
  onOpenChange,
}: {
  wo: WorkOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: engineers, isLoading } = useEngineerList();
  const assign = useAssignWorkOrderEngineer();
  const [engineerId, setEngineerId] = useState("");

  const waiting = wo ? formatDistanceToNowStrict(new Date(wo.created_at)) : "";

  const submit = () => {
    if (!wo || !engineerId) return;
    assign.mutate(
      { woId: wo.id, engineerId },
      {
        onSuccess: (res) => {
          toast({
            title: `WO-${String(wo.wo_number).padStart(6, "0")} assigned to ${res?.engineer_name ?? "engineer"}`,
            description: "They have been notified. The order stays open until they accept it.",
          });
          setEngineerId("");
          onOpenChange(false);
        },
        onError: (err: Error) => toast({ title: "Could not assign", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setEngineerId(""); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {wo ? `WO-${String(wo.wo_number).padStart(6, "0")}` : "maintenance order"}</DialogTitle>
          <DialogDescription>
            {wo?.machine ? `${wo.machine} · ` : ""}Open for {waiting} with nobody accepting it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Engineer</Label>
          <Select value={engineerId} onValueChange={setEngineerId} disabled={isLoading}>
            <SelectTrigger><SelectValue placeholder={isLoading ? "Loading engineers…" : "Select engineer…"} /></SelectTrigger>
            <SelectContent>
              {(engineers ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The order stays open and still needs the engineer to accept it — that is what records the response time.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={assign.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!engineerId || assign.isPending}>
            {assign.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AssignEngineerDialog;
