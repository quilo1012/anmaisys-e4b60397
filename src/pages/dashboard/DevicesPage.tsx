import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tablet, Copy, Check, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useLines } from "@/hooks/useMachines";
import { useAllDevices, usePairDevice, useUnpairDevice, useDeviceLine, getDeviceToken } from "@/hooks/useDevice";
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

function DevicesPageContent() {
  const { data: lines } = useLines();
  const { data: devices, isLoading } = useAllDevices();
  const { data: thisDevice } = useDeviceLine();
  const pair = usePairDevice();
  const unpair = useUnpairDevice();
  const { toast } = useToast();

  const [pairToken, setPairToken] = useState("");
  const [pairLineId, setPairLineId] = useState("");
  const [pairLabel, setPairLabel] = useState("");
  const [copied, setCopied] = useState(false);

  const myToken = getDeviceToken();

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(myToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handlePair = async () => {
    if (!pairToken.trim() || !pairLineId) {
      toast({ title: "Missing info", description: "Token and line are required.", variant: "destructive" });
      return;
    }
    try {
      await pair.mutateAsync({ token: pairToken.trim(), lineId: pairLineId, label: pairLabel.trim() || undefined });
      toast({ title: "Device paired", description: "The tablet is now bound to the selected line." });
      setPairToken(""); setPairLineId(""); setPairLabel("");
    } catch (e: any) {
      toast({ title: "Pair failed", description: e.message, variant: "destructive" });
    }
  };

  const lineName = (id: string | null) => lines?.find((l) => l.id === id)?.name ?? "—";

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Tablet className="h-7 w-7 text-primary" /> Tablet Devices
          </h1>
          <p className="text-muted-foreground">Bind each tablet to a production line. Operators on a paired tablet only see that line's work orders.</p>
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
            <div className="text-sm">
              Currently bound to:{" "}
              {thisDevice?.line_id ? (
                <Badge variant="default">{lineName(thisDevice.line_id)}</Badge>
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
              Open the app on the target tablet, copy its token from this same page, then paste it below.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Input
              placeholder="Device token"
              value={pairToken}
              onChange={(e) => setPairToken(e.target.value)}
              className="md:col-span-2 font-mono"
            />
            <Select value={pairLineId} onValueChange={setPairLineId}>
              <SelectTrigger><SelectValue placeholder="Select line" /></SelectTrigger>
              <SelectContent>
                {lines?.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              placeholder="Label (optional)"
              value={pairLabel}
              onChange={(e) => setPairLabel(e.target.value)}
            />
            <div className="md:col-span-4">
              <Button onClick={handlePair} disabled={pair.isPending}>
                {pair.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Pair Device
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* All devices */}
        <Card>
          <CardHeader>
            <CardTitle>All Devices</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !devices?.length ? (
              <p className="text-muted-foreground text-sm py-4">No devices registered yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Line</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((d: any) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.label || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {d.line_id ? <Badge>{lineName(d.line_id)}</Badge> : <Badge variant="outline">Unpaired</Badge>}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[180px] truncate">{d.device_token}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {d.last_seen_at ? format(new Date(d.last_seen_at), "PP p") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {d.line_id && (
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
