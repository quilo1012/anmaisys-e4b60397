import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ClipboardList, Plus, Loader2, AlertTriangle, Clock, CalendarIcon } from "lucide-react";
import { useWorkOrders, useCreateWorkOrder } from "@/hooks/useWorkOrders";
import { useAuth } from "@/contexts/AuthContext";
import { usePartsCountByWOs } from "@/hooks/useStock";
import { useMachines } from "@/hooks/useMachines";
import { useActiveProblemDescriptions } from "@/hooks/useProblemDescriptions";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 border-blue-200" },
  received: { label: "Received", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  arrived: { label: "Arrived", className: "bg-purple-100 text-purple-800 border-purple-200" },
  in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  finished: { label: "Finished", className: "bg-teal-100 text-teal-800 border-teal-200" },
  closed: { label: "Closed", className: "bg-green-100 text-green-800 border-green-200" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200" },
};

export default function OperatorDashboard() {
  const { profile } = useAuth();
  const [requesterName, setRequesterName] = useState("");
  const [line, setLine] = useState("");
  const [machine, setMachine] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const { data: workOrders, isLoading } = useWorkOrders({ operatorOnly: true });
  const { data: allWOs } = useWorkOrders();
  const woIds = workOrders?.map((wo) => wo.id) || [];
  const { data: partsCounts } = usePartsCountByWOs(woIds);
  const { data: machines } = useMachines();
  const { data: problemDescriptions } = useActiveProblemDescriptions();
  const createWO = useCreateWorkOrder();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Distinct lines for filter
  const lines = useMemo(() => {
    if (!machines) return [];
    const lineSet = new Set<string>();
    machines.forEach((m) => { if (m.line) lineSet.add(m.line); });
    return Array.from(lineSet).sort();
  }, [machines]);

  // Filter machines by selected line
  const filteredMachines = useMemo(() => {
    if (!machines) return [];
    if (!line) return machines;
    return machines.filter((m) => m.line === line);
  }, [machines, line]);

  // Smart suggestions: recent WOs for selected machine
  const machineSuggestions = useMemo(() => {
    if (!machine || !allWOs) return null;
    const machineWOs = allWOs.filter((w) => w.machine === machine);
    if (!machineWOs.length) return null;
    const lastWO = machineWOs[0];
    const daysSinceLast = differenceInDays(new Date(), new Date(lastWO.created_at));
    // Common problems
    const problemCount: Record<string, number> = {};
    machineWOs.forEach((w) => { problemCount[w.description] = (problemCount[w.description] || 0) + 1; });
    const topProblems = Object.entries(problemCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { totalWOs: machineWOs.length, daysSinceLast, topProblems };
  }, [machine, allWOs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!requesterName.trim() && !profile?.name) || !machine.trim() || !description.trim()) {
      toast({ title: "Error", description: "All fields are required", variant: "destructive" });
      return;
    }
    try {
      await createWO.mutateAsync({ requester_name: (requesterName.trim() || profile?.name || "").trim(), machine: machine.trim(), description: description.trim(), notes: notes.trim(), priority: "medium" });
      toast({ title: "Work Order Created", description: "Your WO has been submitted." });
      setRequesterName(""); setLine(""); setMachine(""); setDescription(""); setNotes("");
    } catch {
      toast({ title: "Error", description: "Failed to create work order", variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Operator Panel</h2>
          <p className="text-muted-foreground">Create and track your work orders</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create Work Order
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="requester">Requested By</Label>
                <Input id="requester" value={requesterName || profile?.name || ""} readOnly className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label>Line</Label>
                <Select value={line} onValueChange={(v) => { setLine(v); setMachine(""); }}>
                  <SelectTrigger><SelectValue placeholder="Select line..." /></SelectTrigger>
                  <SelectContent>
                    {lines.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="machine">Machine</Label>
                <Select value={machine} onValueChange={setMachine}>
                  <SelectTrigger><SelectValue placeholder="Select machine..." /></SelectTrigger>
                  <SelectContent>
                    {filteredMachines.map((m) => (
                      <SelectItem key={m.id} value={m.name}>
                        {m.name}{m.current_location ? ` (${m.current_location})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Problem Description</Label>
                <Select value={description} onValueChange={setDescription}>
                  <SelectTrigger><SelectValue placeholder="Select problem..." /></SelectTrigger>
                  <SelectContent>
                    {problemDescriptions?.map((pd) => (
                      <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Observations (optional)</Label>
                <Textarea id="notes" placeholder="Additional notes or context..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </div>
              {/* Smart Suggestions */}
              {machineSuggestions && (
                <div className="md:col-span-2">
                  <Card className="border-amber-500/30 bg-amber-500/5">
                    <CardContent className="p-3 flex flex-wrap gap-4 items-center text-sm">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <span className="font-medium">{machineSuggestions.totalWOs} previous WO(s)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span>Last WO: {machineSuggestions.daysSinceLast} day(s) ago</span>
                      </div>
                      {machineSuggestions.topProblems.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-muted-foreground">Common:</span>
                          {machineSuggestions.topProblems.map(([problem, count]) => (
                            <Badge key={problem} variant="secondary" className="text-xs">{problem} ({count}x)</Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
              <div className="md:col-span-2">
                <Button type="submit" disabled={createWO.isPending}>
                  {createWO.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Submit Work Order
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              My Work Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !workOrders?.length ? (
              <p className="text-muted-foreground text-center py-8">No work orders yet. Create one above!</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                     <TableHead>WO#</TableHead>
                     <TableHead>Line</TableHead>
                     <TableHead>Machine</TableHead>
                     <TableHead>Problem</TableHead>
                     <TableHead>Status</TableHead>
                     <TableHead>Created</TableHead>
                     <TableHead>Engineer</TableHead>
                     <TableHead>Parts</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {workOrders.map((wo) => {
                     const cfg = statusConfig[wo.status] || statusConfig.open;
                     return (
                       <TableRow key={wo.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
                         <TableCell className="font-mono font-medium">WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}</TableCell>
                         <TableCell className="font-medium">{machines?.find((m) => m.name === wo.machine)?.line || "—"}</TableCell>
                         <TableCell>{wo.machine}</TableCell>
                         <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{wo.description}</TableCell>
                         <TableCell><Badge variant="outline" className={cfg.className}>{cfg.label}</Badge></TableCell>
                         <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>
                         <TableCell className="text-sm">{wo.engineer?.name || "—"}</TableCell>
                         <TableCell>
                           {partsCounts?.[wo.id] ? (
                             <Badge variant="secondary">{partsCounts[wo.id]}</Badge>
                           ) : (
                             <span className="text-muted-foreground">—</span>
                           )}
                         </TableCell>
                       </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
