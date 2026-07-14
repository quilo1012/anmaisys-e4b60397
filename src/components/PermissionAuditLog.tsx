import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, RefreshCw, ArrowRight, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Row {
  id: string;
  created_at: string;
  user_name: string;
  entity_id: string | null;
  details: any;
}

export function PermissionAuditLog({ limit = 30 }: { limit?: number }) {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["permission_audit_log", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, created_at, user_name, entity_id, details")
        .eq("action", "permission.change")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Permission changes — audit log
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No permission changes recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-center">From → To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.map((row) => {
                  const d = row.details ?? {};
                  const from = String(d.from ?? "");
                  const to = String(d.to ?? "");
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-sm">{row.user_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] uppercase">{d.role ?? "-"}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.action ?? row.entity_id}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={from === "allowed" ? "border-emerald-500/40 text-emerald-600" : "border-border text-muted-foreground"}
                          >
                            {from || "—"}
                          </Badge>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <Badge
                            variant="outline"
                            className={to === "allowed" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-destructive/40 bg-destructive/5 text-destructive"}
                          >
                            {to || "—"}
                          </Badge>
                          {d.reset_to_default && (
                            <Badge variant="secondary" className="ml-1 text-[10px]">reset</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
