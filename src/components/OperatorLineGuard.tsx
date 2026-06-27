import { ReactNode, useEffect, useRef } from "react";
import { Loader2, Tablet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
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

  const toastedRef = useRef<string | null>(null);

  const account = accounts?.find((a) => a.user_id === user?.id) ?? null;
  const allowedIds = account?.line_ids ?? [];
  const isBlocked = !accountsLoading && !linesLoading && (!account || allowedIds.length === 0);

  useEffect(() => {
    if (!isBlocked || !user?.id) return;
    const key = user.id + (account ? ":no-lines" : ":no-account");
    if (toastedRef.current === key) return;
    toastedRef.current = key;
    if (!account) {
      toast.error("No tablet account linked to this login", {
        description: `Signed in as ${user.email ?? "this user"}, but no operator/line binding was found. Ask an admin to configure it.`,
        duration: 8000,
      });
    } else {
      toast.warning("Tablet account has no lines assigned", {
        description: `"${account.label}" is configured but has zero production lines. Ask a manager to assign at least one line.`,
        duration: 8000,
      });
    }
  }, [isBlocked, account, user?.id, user?.email]);

  if (accountsLoading || linesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // No account or unbound — block everything.
  if (isBlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg border-2 border-amber-500/40">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
              <Tablet className="h-8 w-8 text-amber-500" />
            </div>
            <CardTitle className="text-2xl">
              {account ? "No lines assigned to this account" : "Tablet account not configured"}
            </CardTitle>
            <CardDescription className="mt-2 text-base">
              {account ? (
                <>The account <span className="font-semibold">"{account.label}"</span> exists but has no production lines. Ask a manager to assign at least one line in <span className="font-semibold">Manage Users → Tablet Accounts</span>.</>
              ) : (
                <>Signed in as <span className="font-semibold">{user?.email ?? "this user"}</span>, but this login is not bound to any production line. Ask a manager or admin to configure it in <span className="font-semibold">Manage Users → Tablet Accounts</span>.</>
              )}
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

  // Build the allowed-line list (id + name). Skip ids that don't resolve to a
  // real line (stale bindings) so the operator never sees "Unknown line".
  const allowedLines: AllowedLine[] = allowedIds
    .map((id) => {
      const found = lines?.find((l) => l.id === id);
      return found ? { id, name: found.name } : null;
    })
    .filter((x): x is AllowedLine => x !== null);

  return (
    <DeviceLineProvider
      allowedLines={allowedLines}
      deviceToken=""
      label={account.label}
    >
      <LineSelector />
      {children}
    </DeviceLineProvider>
  );
}

/**
 * Compact line switcher. Hidden when the account is bound to a single line
 * (login is per-line, so there's nothing to choose). Only renders when the
 * account covers multiple lines and the operator must pick one.
 */
function LineSelector() {
  const { allowedLines, selectedLineId, setSelectedLineId } = useDeviceLineCtx();

  if (allowedLines.length <= 1) return null;

  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Line:</span>
      <div className="w-56">
        <Select value={selectedLineId} onValueChange={setSelectedLineId}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Select line" />
          </SelectTrigger>
          <SelectContent>
            {allowedLines.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
