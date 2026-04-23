import { ReactNode, useState } from "react";
import { Loader2, Tablet, Lock, Copy, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDeviceLines, getDeviceToken } from "@/hooks/useDevice";
import { useLines } from "@/hooks/useMachines";
import { DeviceLineProvider, useDeviceLineCtx, AllowedLine } from "@/contexts/DeviceLineContext";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Hard gate for operator screens. Resolves the device → allowed-lines binding and:
 *  - shows a spinner while loading
 *  - blocks the UI with a setup card when the tablet has zero allowed lines
 *  - renders children + DeviceLineProvider when at least one line is paired
 */
export function OperatorLineGuard({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { data: device, isLoading } = useDeviceLines();
  const { data: lines } = useLines();
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const allowedIds = device?.allowedLineIds ?? [];

  // Unpaired — block everything.
  if (allowedIds.length === 0) {
    const token = getDeviceToken();
    const handleCopy = async () => {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg border-2 border-amber-500/40">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
              <Tablet className="h-8 w-8 text-amber-500" />
            </div>
            <CardTitle className="text-2xl">Tablet not assigned to any line</CardTitle>
            <CardDescription className="mt-2 text-base">
              This tablet must be paired to one or more production lines before operators can
              create or view work orders.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-medium">Ask a manager or admin to:</p>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Open <span className="font-mono">Devices</span> in the dashboard</li>
                <li>Paste this device token and select the allowed lines</li>
              </ol>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                This device's token
              </p>
              <div className="flex items-center gap-2">
                <Input value={token} readOnly className="font-mono text-sm" />
                <Button variant="outline" size="icon" onClick={handleCopy} aria-label="Copy token">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Button variant="ghost" className="w-full" onClick={() => signOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Build the allowed-line list (id + name) from the lines table.
  const allowedLines: AllowedLine[] = allowedIds
    .map((id) => {
      const name = lines?.find((l) => l.id === id)?.name ?? "Unknown line";
      return { id, name };
    });

  return (
    <DeviceLineProvider
      allowedLines={allowedLines}
      deviceToken={getDeviceToken()}
      label={device?.label ?? null}
    >
      <LineSelectionBanner />
      {children}
    </DeviceLineProvider>
  );
}

function LineSelectionBanner() {
  const { allowedLines, selectedLineId, selectedLineName, setSelectedLineId, label } =
    useDeviceLineCtx();

  // Single line — show locked banner.
  if (allowedLines.length === 1) {
    return (
      <div className="border-2 border-primary bg-primary/10 rounded-lg p-4 mb-4 flex items-center gap-3">
        <Lock className="h-6 w-6 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            {label ? `${label} · ` : ""}This tablet is locked to
          </p>
          <p className="text-2xl font-bold text-primary truncate">{selectedLineName}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            All work orders are automatically assigned to this line.
          </p>
        </div>
      </div>
    );
  }

  // Multiple lines — show selector.
  return (
    <div className="border-2 border-primary bg-primary/10 rounded-lg p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <Lock className="h-6 w-6 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          {label ? `${label} · ` : ""}Tablet authorized for
        </p>
        <p className="text-sm font-medium text-foreground truncate">
          {allowedLines.map((l) => l.name).join(" · ")}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Work orders use the line selected on the right.
        </p>
      </div>
      <div className="sm:w-64 w-full">
        <Select value={selectedLineId} onValueChange={setSelectedLineId}>
          <SelectTrigger className="h-12 text-base font-semibold border-primary">
            <SelectValue placeholder="Select line" />
          </SelectTrigger>
          <SelectContent>
            {allowedLines.map((l) => (
              <SelectItem key={l.id} value={l.id} className="text-base">
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
