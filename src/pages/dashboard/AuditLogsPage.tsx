import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Search, Shield, Trash2 } from "lucide-react";
import { useAuditLogs, logAuditEvent } from "@/hooks/useAuditLogs";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

export default function AuditLogsPage() {
  const [entityType, setEntityType] = useState("all");
  const [search, setSearch] = useState("");
  const [pin, setPin] = useState("");
  const [clearing, setClearing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const { role, profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: logs, isLoading } = useAuditLogs({ entityType, search });

  const entityTypes = useMemo(() => {
    if (!logs) return [];
    return [...new Set(logs.map((l) => l.entity_type))].sort();
  }, [logs]);

  const handleClearLogs = async () => {
    setClearing(true);
    try {
      // Verify PIN server-side via edge function
      const { data: verifyData, error: verifyError } = await supabase.functions.invoke("verify-admin-pin", {
        body: { pin },
      });
      if (verifyError || !verifyData?.valid) {
        toast({ title: "Invalid PIN", variant: "destructive" });
        setClearing(false);
        return;
      }
      const { error } = await supabase.from("audit_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["audit_logs"] });
      logAuditEvent("audit_logs_cleared", "system", undefined, { cleared_by: profile?.email });
      toast({ title: "Audit logs cleared" });
      setDialogOpen(false);
      setPin("");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6" /> Audit Logs</h2>
            <p className="text-muted-foreground">Complete activity log for compliance and security</p>
          </div>
          {role === "admin" && (
            <AlertDialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setPin(""); setConfirmText(""); } }}>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm"><Trash2 className="h-4 w-4 mr-2" />Clear Logs</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear All Audit Logs?</AlertDialogTitle>
                  <AlertDialogDescription>This action cannot be undone. Enter admin PIN and type CONFIRM to proceed.</AlertDialogDescription>
                </AlertDialogHeader>
                <Input type="password" placeholder="Admin PIN" value={pin} onChange={(e) => setPin(e.target.value)} maxLength={10} />
                <Input placeholder='Type "CONFIRM" to proceed' value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearLogs} disabled={!pin || clearing || confirmText !== "CONFIRM"}>
                    {clearing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Confirm
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-[300px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search user, action..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
              </div>
              <Select value={entityType} onValueChange={setEntityType}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Entity type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {entityTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !logs?.length ? (
              <div className="text-center py-12">
                <Shield className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground font-medium">No audit logs found</p>
                <p className="text-muted-foreground text-sm mt-1">Activity will appear here as actions are performed.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss")}</TableCell>
                      <TableCell className="font-medium">{log.user_name}</TableCell>
                      <TableCell><Badge variant="outline">{log.action}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{log.entity_type}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{log.entity_id ? log.entity_id.slice(0, 8) + "..." : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[300px]">
                        {log.details?.before || log.details?.after ? (
                          <div className="space-y-0.5">
                            {log.details.before && <div><span className="text-destructive font-medium">Before:</span> {typeof log.details.before === "object" ? JSON.stringify(log.details.before) : String(log.details.before)}</div>}
                            {log.details.after && <div><span className="text-green-600 font-medium">After:</span> {typeof log.details.after === "object" ? JSON.stringify(log.details.after) : String(log.details.after)}</div>}
                          </div>
                        ) : Object.keys(log.details || {}).length ? JSON.stringify(log.details) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
