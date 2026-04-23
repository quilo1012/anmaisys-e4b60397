import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Tablet,
  Copy,
  Check,
  Trash2,
  Loader2,
  Pencil,
  Tag,
  KeyRound,
  Network,
  AlertTriangle,
  Save,
  Clock,
  Link2,
} from "lucide-react";
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
    <div className="grid gap-2 sm:grid-cols-2 max-h-64 overflow-y-auto rounded-md border bg-muted/20 p-3">
      {lines.map((l) => (
        <Label
          key={l.id}
          className="flex items-center gap-2 cursor-pointer rounded-md p-2 hover:bg-accent transition-colors"
        >
          <Checkbox checked={selected.has(l.id)} onCheckedChange={() => onToggle(l.id)} />
          <span className="text-sm font-medium">{l.name}</span>
        </Label>
      ))}
    </div>
  );
}

/** Small section heading used inside the edit dialog */
function SectionHeader({
  icon: Icon,
  title,
  hint,
  right,
}: {
  icon: React.ElementType;
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {hint && <span className="text-xs text-muted-foreground">· {hint}</span>}
      </div>
      {right}
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
  const [editTokenCopied, setEditTokenCopied] = useState(false);

  // Edit-existing dialog state
  const [editing, setEditing] = useState<null | {
    id: string;
    token: string;
    label: string | null;
    lineSet: Set<string>;
    lastSeenAt: string | null;
    pairedAt: string | null;
  }>(null);

  const myToken = getDeviceToken();

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(myToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCopyEditToken = async () => {
    if (!editing) return;
    await navigator.clipboard.writeText(editing.token);
    setEditTokenCopied(true);
    setTimeout(() => setEditTokenCopied(false), 1500);
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

  const handleSelectAllEdit = () => {
    setEditing((prev) => {
      if (!prev || !lines) return prev;
      const allIds = lines.map((l) => l.id);
      const allSelected = allIds.every((id) => prev.lineSet.has(id));
      return {
        ...prev,
        lineSet: allSelected ? new Set() : new Set(allIds),
      };
    });
  };

  const editAllSelected = useMemo(() => {
    if (!editing || !lines?.length) return false;
    return lines.every((l) => editing.lineSet.has(l.id));
  }, [editing, lines]);

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
        label: editing.label?.trim() ? editing.label.trim() : undefined,
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

  const handleUnpairFromDialog = async () => {
    if (!editing) return;
    try {
      await unpair.mutateAsync(editing.id);
      toast({
        title: "Device unpaired",
        description: "All line authorizations removed.",
      });
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Unpair failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <TooltipProvider delayDuration={300}>
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
              <CardDescription>
                Click the edit icon on any device to manage its label, allowed lines and pairing.
              </CardDescription>
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
                        <TableRow key={d.id} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="py-3">
                            {d.label || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="py-3">
                            {allowed.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {allowed.map((l) => (
                                  <Badge key={l.id} className="gap-1">
                                    <Link2 className="h-3 w-3" />
                                    {l.name}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <Badge variant="outline">Unpaired</Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[180px] truncate py-3">
                            {d.device_token}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground py-3">
                            {d.last_seen_at ? format(new Date(d.last_seen_at), "PP p") : "—"}
                          </TableCell>
                          <TableCell className="text-right py-3">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() =>
                                    setEditing({
                                      id: d.id,
                                      token: d.device_token,
                                      label: d.label ?? null,
                                      lineSet: new Set(allowed.map((l) => l.id)),
                                      lastSeenAt: d.last_seen_at ?? null,
                                      pairedAt: d.paired_at ?? null,
                                    })
                                  }
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit device</TooltipContent>
                            </Tooltip>
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
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-primary" /> Edit Tablet Device
              </DialogTitle>
              <DialogDescription>
                Manage label, allowed lines and pairing status for this tablet.
              </DialogDescription>
            </DialogHeader>

            {editing && (
              <div className="space-y-6 py-2">
                {/* Section 1 — Identification */}
                <section>
                  <SectionHeader icon={Tag} title="Identification" />
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-label" className="text-xs text-muted-foreground">
                        Device Label
                      </Label>
                      <Input
                        id="edit-label"
                        value={editing.label ?? ""}
                        onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                        placeholder="e.g. Floor tablet 3 — Packing area"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <KeyRound className="h-3 w-3" /> Device Token
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input value={editing.token} readOnly className="font-mono text-xs" />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" size="icon" onClick={handleCopyEditToken}>
                              {editTokenCopied ? (
                                <Check className="h-4 w-4" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Copy token</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="rounded-md border bg-muted/20 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Last seen
                        </div>
                        <div className="text-sm font-medium">
                          {editing.lastSeenAt
                            ? format(new Date(editing.lastSeenAt), "PP p")
                            : "—"}
                        </div>
                      </div>
                      <div className="rounded-md border bg-muted/20 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                          <Link2 className="h-3 w-3" /> Paired at
                        </div>
                        <div className="text-sm font-medium">
                          {editing.pairedAt
                            ? format(new Date(editing.pairedAt), "PP p")
                            : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <Separator />

                {/* Section 2 — Authorized Lines */}
                <section>
                  <SectionHeader
                    icon={Network}
                    title="Authorized Lines"
                    hint={`${editing.lineSet.size} selected`}
                    right={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleSelectAllEdit}
                        className="h-7 text-xs"
                      >
                        {editAllSelected ? "Clear all" : "Select all"}
                      </Button>
                    }
                  />
                  <LineCheckboxList
                    lines={lines}
                    selected={editing.lineSet}
                    onToggle={toggleEditLine}
                  />
                  {editing.lineSet.size === 0 && (
                    <div className="mt-2 flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>Saving with zero lines will block this tablet from operating.</span>
                    </div>
                  )}
                </section>

                {/* Section 3 — Danger Zone (only if currently paired) */}
                {(() => {
                  const device = devices?.find((d: any) => d.id === editing.id);
                  const wasPaired = (device?.allowed_lines ?? []).length > 0;
                  if (!wasPaired) return null;
                  return (
                    <>
                      <Separator />
                      <section>
                        <SectionHeader icon={AlertTriangle} title="Danger Zone" />
                        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
                          <div>
                            <p className="text-sm font-medium">Unpair this device</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Removes all line authorizations. The tablet will be blocked until
                              paired again.
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={handleUnpairFromDialog}
                            disabled={unpair.isPending}
                          >
                            {unpair.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            Unpair this device
                          </Button>
                        </div>
                      </section>
                    </>
                  );
                })()}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveEdit} disabled={pair.isPending}>
                {pair.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    </DashboardLayout>
  );
}
