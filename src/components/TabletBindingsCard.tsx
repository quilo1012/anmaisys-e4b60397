import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLines } from "@/hooks/useMachines";
import {
  useOperatorAccounts,
  useUpdateOperatorAccountLines,
  type OperatorLineAccount,
} from "@/hooks/useOperatorAccounts";

const STORAGE_KEY = "an_tablet_binding_confirm_v1";

type ConfirmMap = Record<string, { hash: string; at: string; by?: string }>;

function loadConfirmations(): ConfirmMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as ConfirmMap;
  } catch {
    return {};
  }
}
function saveConfirmations(map: ConfirmMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}
function bindingHash(acc: OperatorLineAccount): string {
  return [...(acc.line_ids || [])].sort().join("|");
}

function tokens(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function labelMatchesLines(label: string, lineNames: string[]): boolean {
  if (!lineNames.length) return false;
  const lt = tokens(label);
  if (!lt.length) return false;
  // Pass if any line name shares a meaningful token (length ≥ 3) with the label
  return lineNames.some((ln) => {
    const nt = tokens(ln);
    return nt.some((t) => t.length >= 3 && lt.includes(t));
  });
}

interface Row {
  acc: OperatorLineAccount;
  lineNames: string[];
  status: "ok" | "missing" | "mismatch" | "unknown_line";
  unknownIds: string[];
  confirmed?: { at: string; stale: boolean };
}

export function TabletBindingsCard() {
  const { toast } = useToast();
  const { data: lines, isLoading: linesLoading } = useLines();
  const { data: accounts, isLoading: accLoading, refetch } = useOperatorAccounts();
  const updateAcc = useUpdateOperatorAccountLines();

  const [confirmations, setConfirmations] = useState<ConfirmMap>(loadConfirmations);
  const [busyId, setBusyId] = useState<string | null>(null);

  const lineMap = useMemo(() => {
    const m = new Map<string, string>();
    lines?.forEach((l) => m.set(l.id, l.name));
    return m;
  }, [lines]);

  const rows: Row[] = useMemo(() => {
    return (accounts ?? []).map<Row>((acc) => {
      const lineIds = acc.line_ids ?? [];
      const unknownIds = lineIds.filter((id) => !lineMap.has(id));
      const lineNames = lineIds.map((id) => lineMap.get(id) ?? "(deleted)");
      let status: Row["status"] = "ok";
      if (lineIds.length === 0) status = "missing";
      else if (unknownIds.length > 0) status = "unknown_line";
      else if (!labelMatchesLines(acc.label, lineNames)) status = "mismatch";

      const c = confirmations[acc.id];
      const confirmed = c
        ? { at: c.at, stale: c.hash !== bindingHash(acc) }
        : undefined;

      return { acc, lineNames, status, unknownIds, confirmed };
    });
  }, [accounts, lineMap, confirmations]);

  const handleConfirm = async (row: Row) => {
    if (row.status !== "ok") {
      toast({
        title: "Cannot confirm",
        description: "Fix the binding below before confirming.",
        variant: "destructive",
      });
      return;
    }
    setBusyId(row.acc.id);
    try {
      // Re-save the binding to assert the current line set is intentional.
      await updateAcc.mutateAsync({
        id: row.acc.id,
        label: row.acc.label,
        line_ids: row.acc.line_ids,
      });
      const next: ConfirmMap = {
        ...confirmations,
        [row.acc.id]: { hash: bindingHash(row.acc), at: new Date().toISOString() },
      };
      saveConfirmations(next);
      setConfirmations(next);
      toast({ title: "Binding confirmed", description: row.acc.label });
      refetch();
    } catch (e: any) {
      toast({
        title: "Confirm failed",
        description: e?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const renderStatus = (row: Row) => {
    if (row.status === "ok") {
      return (
        <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Valid
        </Badge>
      );
    }
    if (row.status === "missing") {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" /> No line assigned
        </Badge>
      );
    }
    if (row.status === "unknown_line") {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" /> Unknown line {row.unknownIds.length > 1 ? "s" : ""}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="bg-amber-500/15 text-amber-500 border-amber-500/30">
        <AlertTriangle className="h-3 w-3 mr-1" /> Label ↔ line mismatch
      </Badge>
    );
  };

  const isLoading = linesLoading || accLoading;
  const invalidCount = rows.filter((r) => r.status !== "ok").length;
  const unconfirmedCount = rows.filter(
    (r) => r.status === "ok" && (!r.confirmed || r.confirmed.stale),
  ).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Tablet ↔ Line Bindings
            </CardTitle>
            <CardDescription>
              Verify and confirm which production line each tablet login is paired to. Edit the binding in
              the section below if needed, then confirm here.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {invalidCount > 0 && (
              <Badge variant="destructive">{invalidCount} need fix</Badge>
            )}
            {unconfirmedCount > 0 && (
              <Badge variant="secondary" className="bg-amber-500/15 text-amber-500 border-amber-500/30">
                {unconfirmedCount} unconfirmed
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
            No tablet accounts yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tablet (label)</TableHead>
                <TableHead>Line(s)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last confirmed</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.acc.id}>
                  <TableCell className="font-medium">{row.acc.label}</TableCell>
                  <TableCell>
                    {row.lineNames.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {row.lineNames.map((n, i) => (
                          <Badge key={i} variant="outline" className="font-normal">
                            {n}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{renderStatus(row)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.confirmed ? (
                      <>
                        {new Date(row.confirmed.at).toLocaleString()}{" "}
                        {row.confirmed.stale && (
                          <Badge variant="secondary" className="ml-1 bg-amber-500/15 text-amber-500 border-amber-500/30">
                            changed
                          </Badge>
                        )}
                      </>
                    ) : (
                      <span className="italic">never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={row.status === "ok" ? "default" : "outline"}
                      disabled={row.status !== "ok" || busyId === row.acc.id}
                      onClick={() => handleConfirm(row)}
                    >
                      {busyId === row.acc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <ShieldCheck className="h-4 w-4 mr-1" />
                          Confirm
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
