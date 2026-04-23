import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tablet, Copy, Check, Trash2, Loader2, Pencil } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useLines } from "@/hooks/useMachines";
import {
  useAllDevices,
  usePairDeviceLines,
  useUnpairDevice,
  useDeviceLines,
  getDeviceToken,
} from "@/hooks/useDevice";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function DevicesPage() {
  const { role, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (role !== "admin" && role !== "manager") {
    return <Navigate to="/login" replace />;
  }
  return <DevicesPageContent />;
}

interface LineCheckboxListProps {
  lines: { id: string; name: string }[] | undefined;
  selected: Set<string>;
  onToggle: (id: string) => void;
}
function LineCheckboxList({ lines, selected, onToggle }: LineCheckboxListProps) {
  if (!lines?.length) {
    return <p className="text-sm text-muted-foreground">No lines available.</p>;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 max-h-64 overflow-y-auto rounded-md border p-3">
      {lines.map((l) => (
        <Label
          key={l.id}
          className="flex items-center gap-2 cursor-pointer rounded-md p-2 hover:bg-accent"
        >
          <Checkbox checked={selected.has(l.id)} onCheckedChange={() => onToggle(l.id)} />
          <span className="text-sm font-medium">{l.name}</span>
        </Label>
      ))}
    </div>
  );
}

function DevicesPageContent() {
  const { data: lines } = useLines();
  const { data: devices, isLoading } = useAllDevices();
  const { data: thisDevice } = useDeviceLines();
  const pair = usePairDeviceLines();
  const unpair = useUnpairDevice();
  const { toast } = useToast();

  // Pair-new form state
  const [pairToken, setPairToken] = useState("");
  const [pairLabel, setPairLabel] = useState("");
  const [pairLineSet, setPairLineSet] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  // Edit-existing dialog state
  const [editing, setEditing] = useState<null | {
    id: string;
    token: string;
    label: string | null;
    lineSet: Set<string>;
  }>(null);

  const myToken = getDeviceToken();

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(myToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const togglePairLine = (id: string) => {
    setPairLineSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEditLine = (id: string) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.lineSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, lineSet: next };
    });
  };

  const handlePair = async () => {
    if (!pairToken.trim() || pairLineSet.size === 0) {
      toast({
        title: "Missing info",
        description: "Token and at least one line are required.",
        variant: "destructive",
      });
      return;
    }
    try {
      await pair.mutateAsync({
        token: pairToken.trim(),
        lineIds: Array.from(pairLineSet),
        label: pairLabel.trim() || undefined,
      });
      toast({
        title: "Device paired",
        description: `Tablet authorized for ${pairLineSet.size} line(s).`,
      });
      setPairToken("");
      setPairLabel("");
      setPairLineSet(new Set());
    } catch (e: any) {
      toast({ title: "Pair failed", description: e.message, variant: "destructive" });
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    try {
      await pair.mutateAsync({
        token: editing.token,
        lineIds: Array.from(editing.lineSet),
        label: editing.label ?? undefined,
      });
      toast({
        title: "Device updated",
        description: `Tablet authorized for ${editing.lineSet.size} line(s).`,
      });
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Tablet className="h-7 w-7 text-primary" /> Tablet Devices
          </h1>
          <p className="text-muted-foreground">
            Bind each tablet to one or more production lines. Operators on a paired tablet only
            see work orders for the lines authorized here.
          </p>
        </div>

        {/* This device's token */}
        <Card>
          <CardHeader>
            <CardTitle>This Device</CardTitle>
            <CardDescription>Use this token to pair the tablet you're currently on.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Input value={myToken} readOnly className="font-mono" />
              <Button variant="outline" onClick={handleCopyToken}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="text-sm flex flex-wrap items-center gap-2">
              <span>Currently authorized for:</span>
              {thisDevice && thisDevice.allowedLineIds.length > 0 ? (
                thisDevice.allowedLineIds.map((id) => {
                  const name = lines?.find((l) => l.id === id)?.name ?? "Unknown";
                  return <Badge key={id} variant="default">{name}</Badge>;
                })
              ) : (
                <Badge variant="outline">Unpaired</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pair a device */}
        <Card>
          <CardHeader>
            <CardTitle>Pair a Tablet</CardTitle>
            <CardDescription>
              Open the app on the target tablet, copy its token from this same page, paste it
              below, and tick every line that tablet should be allowed to operate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Device token
                </Label>
                <Input
                  placeholder="Paste device token"
                  value={pairToken}
                  onChange={(e) => setPairToken(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Label (optional)
                </Label>
                <Input
                  placeholder="e.g. Floor tablet 3"
                  value={pairLabel}
                  onChange={(e) => setPairLabel(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Allowed lines ({pairLineSet.size} selected)
              </Label>
              <LineCheckboxList lines={lines} selected={pairLineSet} onToggle={togglePairLine} />
            </div>

            <Button onClick={handlePair} disabled={pair.isPending}>
              {pair.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Pair Device
            </Button>
          </CardContent>
        </Card>

        {/* All devices */}
        <Card>
          <CardHeader>
            <CardTitle>All Devices</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !devices?.length ? (
              <p className="text-muted-foreground text-sm py-4">No devices registered yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Allowed Lines</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((d: any) => {
                    const allowed: { id: string; name: string }[] = d.allowed_lines ?? [];
                    return (
                      <TableRow key={d.id}>
                        <TableCell>{d.label || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>
                          {allowed.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {allowed.map((l) => (
                                <Badge key={l.id}>{l.name}</Badge>
                              ))}
                            </div>
                          ) : (
                            <Badge variant="outline">Unpaired</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[180px] truncate">
                          {d.device_token}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {d.last_seen_at ? format(new Date(d.last_seen_at), "PP p") : "—"}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setEditing({
                                id: d.id,
                                token: d.device_token,
                                label: d.label ?? null,
                                lineSet: new Set(allowed.map((l) => l.id)),
                              })
                            }
                          >
                            <Pencil className="h-4 w-4 mr-1" /> Edit
                          </Button>
                          {allowed.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => unpair.mutate(d.id)}
                              disabled={unpair.isPending}
                            >
                              <Trash2 className="h-4 w-4 mr-1" /> Unpair
                            </Button>
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

      {/* Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit allowed lines</DialogTitle>
            <DialogDescription>
              Choose every line this tablet is allowed to operate. The operator will be able to
              switch between these lines on the device banner.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Label
                </Label>
                <Input
                  value={editing.label ?? ""}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder="Optional label"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Allowed lines ({editing.lineSet.size} selected)
                </Label>
                <LineCheckboxList lines={lines} selected={editing.lineSet} onToggle={toggleEditLine} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={pair.isPending}>
              {pair.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
