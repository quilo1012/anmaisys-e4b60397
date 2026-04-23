import { ReactNode, useState } from "react";
import { Loader2, Tablet, Lock, Copy, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDeviceLine, getDeviceToken } from "@/hooks/useDevice";
import { useLines } from "@/hooks/useMachines";
import { DeviceLineProvider } from "@/contexts/DeviceLineContext";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Hard gate for operator screens. Resolves the device → line binding and:
 *  - shows a spinner while loading
 *  - blocks the UI with a setup card when the tablet is unpaired
 *  - renders children + DeviceLineProvider when paired
 *
 * RLS is the source of truth, but this guard ensures a clean UX and prevents
 * any operator-side calls that would otherwise just return empty.
 */
export function OperatorLineGuard({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { data: device, isLoading } = useDeviceLine();
  const { data: lines } = useLines();
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const lineId = device?.line_id ?? null;

  // Unpaired — block everything.
  if (!lineId) {
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
            <CardTitle className="text-2xl">Tablet not assigned to a line</CardTitle>
            <CardDescription className="mt-2 text-base">
              This tablet must be paired to a production line before operators can create
              or view work orders.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-medium">Ask a manager or admin to:</p>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Open <span className="font-mono">Devices</span> in the dashboard</li>
                <li>Paste this device token and pick a line</li>
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

  const lineName = lines?.find((l) => l.id === lineId)?.name ?? "Unknown line";

  return (
    <DeviceLineProvider
      value={{
        lineId,
        lineName,
        deviceToken: getDeviceToken(),
        label: device?.label ?? null,
      }}
    >
      {/* Locked-line banner */}
      <div className="border-2 border-primary bg-primary/10 rounded-lg p-4 mb-4 flex items-center gap-3">
        <Lock className="h-6 w-6 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
            This tablet is locked to
          </p>
          <p className="text-2xl font-bold text-primary truncate">{lineName}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            All work orders are automatically assigned to this line.
          </p>
        </div>
      </div>

      {children}
    </DeviceLineProvider>
  );
}
