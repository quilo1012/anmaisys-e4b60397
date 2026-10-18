import { Loader2, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Shown while a stored session cannot be renewed because the server is out of
 * reach. The person is still signed in, so this waits and retries rather than
 * showing the password form. "Sign in as someone else" is the way out for a
 * shared device; it signs this device out.
 */
export function SessionReconnecting() {
  const { retryAuth, signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm" role="status" aria-live="polite">
        <WifiOff className="mx-auto h-10 w-10 text-warning-strong" />
        <h1 className="mt-4 text-xl font-semibold text-foreground">Reconnecting…</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You are still signed in. The server can't be reached right now, so your session
          can't be renewed yet. This page will carry on by itself when the connection is back.
        </p>
        <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => void retryAuth()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Try now
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              window.location.replace("/login");
            }}
          >
            Sign in as someone else
          </Button>
        </div>
      </div>
    </div>
  );
}
