import { ReactNode } from "react";
import { Loader2, Tablet, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOperatorAccounts } from "@/hooks/useOperatorAccounts";
import { useLines } from "@/hooks/useMachines";
import { DeviceLineProvider, useDeviceLineCtx, AllowedLine } from "@/contexts/DeviceLineContext";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Hard gate for operator screens. Resolves the operator-account → allowed-lines binding and:
 *  - shows a spinner while loading
 *  - blocks the UI with a setup card when the account has zero allowed lines
 *  - renders children + DeviceLineProvider when at least one line is bound
 *
 * Identity now comes from the logged-in user's `operator_line_accounts` row,
 * not from a per-device token.
 */
export function OperatorLineGuard({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { data: accounts, isLoading: accountsLoading } = useOperatorAccounts();
  const { data: lines, isLoading: linesLoading } = useLines();

  if (accountsLoading || linesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const account = accounts?.find((a) => a.user_id === user?.id) ?? null;
  const allowedIds = account?.line_ids ?? [];

  // No account or unbound — block everything.
  if (!account || allowedIds.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg border-2 border-amber-500/40">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
              <Tablet className="h-8 w-8 text-amber-500" />
            </div>
            <CardTitle className="text-2xl">Tablet account not configured</CardTitle>
            <CardDescription className="mt-2 text-base">
              This login is not bound to any production line. Ask a manager or admin to
              configure it in <span className="font-semibold">Manage Users → Tablet Accounts</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="ghost" className="w-full" onClick={() => signOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Build the allowed-line list (id + name) from the lines table.
  const allowedLines: AllowedLine[] = allowedIds.map((id) => {
    const name = lines?.find((l) => l.id === id)?.name ?? "Unknown line";
    return { id, name };
  });

  return (
    <DeviceLineProvider
      allowedLines={allowedLines}
      deviceToken=""
      label={account.label}
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
