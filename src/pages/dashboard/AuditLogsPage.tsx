import { useState, useMemo, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, Search, Shield, Trash2, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuditLogs } from "@/hooks/useAuditLogs";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/lib/invokeFunction";

const PAGE_SIZE = 50;

export default function AuditLogsPage() {
  const [entityType, setEntityType] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showClear, setShowClear] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [clearing, setClearing] = useState(false);
  const { role } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1); }, [entityType, search]);

  const { data, isLoading, isFetching } = useAuditLogs({ entityType, search, page, pageSize: PAGE_SIZE });
  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

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
    // Derived from the visible page — good enough for a quick filter chip list.
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
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {logs.map((log) => {
                    const d: any = log.details || {};
                    const machine = d.machine || d.after?.machine || d.before?.machine || d.wo_machine;
                    const hasBA = log.details?.before || log.details?.after;
                    return (
                      <div key={log.id} className="rounded-lg border bg-card p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">{format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss")}</p>
                          <p className="text-xs font-mono text-muted-foreground">{log.entity_id ? log.entity_id.slice(0, 8) : "—"}</p>
                        </div>
                        <p className="font-medium text-sm">{log.user_name}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="outline">{log.action}</Badge>
                          <Badge variant="secondary">{log.entity_type}</Badge>
                          {machine && <Badge variant="outline">{machine}</Badge>}
                        </div>
                        {(hasBA || Object.keys(log.details || {}).length) ? (
                          <div className="rounded bg-muted/50 p-2 text-xs space-y-1">
                            {hasBA ? (
                              <>
                                {log.details.before && <div><span className="text-destructive font-medium">Before:</span> {typeof log.details.before === "object" ? JSON.stringify(log.details.before) : String(log.details.before)}</div>}
                                {log.details.after && <div><span className="text-green-600 dark:text-green-400 font-medium">After:</span> {typeof log.details.after === "object" ? JSON.stringify(log.details.after) : String(log.details.after)}</div>}
                              </>
                            ) : (
                              <div className="text-muted-foreground break-all">{JSON.stringify(log.details)}</div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Machine</TableHead>
                    <TableHead>Entity ID</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const d: any = log.details || {};
                    const machine =
                      d.machine || d.after?.machine || d.before?.machine || d.wo_machine || "—";
                    return (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss")}</TableCell>
                      <TableCell className="font-medium">{log.user_name}</TableCell>
                      <TableCell><Badge variant="outline">{log.action}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{log.entity_type}</Badge></TableCell>
                      <TableCell className="text-sm">{machine}</TableCell>
                      <TableCell className="font-mono text-xs">{log.entity_id ? log.entity_id.slice(0, 8) + "..." : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[300px]">
                        {log.details?.before || log.details?.after ? (
                          <div className="space-y-0.5 rounded bg-muted/50 p-2">
                            {log.details.before && <div><span className="text-destructive font-medium">Before:</span> {typeof log.details.before === "object" ? JSON.stringify(log.details.before) : String(log.details.before)}</div>}
                            {log.details.after && <div><span className="text-green-600 dark:text-green-400 font-medium">After:</span> {typeof log.details.after === "object" ? JSON.stringify(log.details.after) : String(log.details.after)}</div>}
                          </div>
                        ) : Object.keys(log.details || {}).length ? JSON.stringify(log.details) : "—"}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </>
            )}

            {/* Pagination footer */}
            {!isLoading && total > 0 && (
              <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground">
                  {total.toLocaleString()} total {total === 1 ? "entry" : "entries"}
                  {" · "}page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || isFetching}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || isFetching}
                  >
                    Next <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
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

