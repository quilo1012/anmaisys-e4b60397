import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, Search, Shield, Trash2, AlertTriangle } from "lucide-react";
import { useAuditLogs } from "@/hooks/useAuditLogs";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/lib/invokeFunction";

export default function AuditLogsPage() {
  const [entityType, setEntityType] = useState("all");
  const [search, setSearch] = useState("");
  const [showClear, setShowClear] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [clearing, setClearing] = useState(false);
  const { role } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: logs, isLoading } = useAuditLogs({ entityType, search });

  const handleClearLogs = async () => {
    setClearing(true);
    const { error } = await invokeFunction("clear-audit-logs");
    setClearing(false);
    if (error) {
      toast({ title: "Error", description: error.message ?? "Failed to clear logs", variant: "destructive" });
      return;
    }
    toast({ title: "Audit logs cleared" });
    setShowClear(false);
    setConfirmText("");
    qc.invalidateQueries({ queryKey: ["audit_logs"] });
  };

  const entityTypes = useMemo(() => {
    if (!logs) return [];
    return [...new Set(logs.map((l) => l.entity_type))].sort();
  }, [logs]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6" /> Audit Logs</h2>
            <p className="text-muted-foreground">Complete activity log for compliance and security.</p>
          </div>
          {role === "admin" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClear(true)}
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" /> Clear Audit Logs
            </Button>
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

        <AlertDialog open={showClear} onOpenChange={(o) => { setShowClear(o); if (!o) setConfirmText(""); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Clear all audit logs?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes every audit log entry. This action cannot be undone.
                Type <span className="font-mono font-semibold">CONFIRM</span> to proceed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              placeholder='Type "CONFIRM"'
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={clearing || confirmText !== "CONFIRM"}
                onClick={(e) => { e.preventDefault(); handleClearLogs(); }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {clearing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Clear All
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}

