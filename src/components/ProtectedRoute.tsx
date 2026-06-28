import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { Loader2, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type AppRole = Database["public"]["Enums"]["app_role"];

const dashMap: Record<AppRole, string> = {
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",
  maintenance_manager: "/dashboard/manager",
  engineer: "/dashboard/engineer",
  operator: "/dashboard/line-production",
  viewer: "/dashboard/manager",
};

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { session, role, profile, loading, authError, silentReLoginInFlight, retryAuth, signOut } = useAuth();

  if (authError && session && !role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <WifiOff className="mx-auto h-10 w-10 text-warning" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">Backend connection is slow</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your login is active, but the system could not load your role and profile yet.
          </p>
          <p className="mt-3 rounded-md bg-muted p-3 text-xs text-muted-foreground break-words">
            {authError}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => void retryAuth()} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await signOut();
                window.location.replace("/login");
              }}
            >
              Back to login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Still resolving session or role — show spinner
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm">Loading AN Maintenance…</span>
        </div>
      </div>
    );
  }

  // Silent re-login in progress (shared tablet refresh-token recovery) — wait
  // instead of bouncing the user to /login. The recovery completes within a
  // few hundred ms; if it fails, the next render will redirect normally.
  if (!session && silentReLoginInFlight) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm">Restoring session…</span>
        </div>
      </div>
    );
  }

  // No session at all — redirect to login
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // Account deactivated — block immediately, even before role resolves
  if (profile && profile.active === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold text-foreground">Account deactivated</h1>
          <p className="text-muted-foreground text-sm">
            Your account has been disabled. Please contact your supervisor to regain access.
          </p>
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              window.location.replace("/login");
            }}
          >
            Back to login
          </Button>
        </div>
      </div>
    );
  }

  // Session exists but role not yet available (shouldn't happen after loading, but guard)
  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm">Loading permissions…</span>
        </div>
      </div>
    );
  }

  // Role loaded but not authorized for this route — show access denied
  if (allowedRoles && !allowedRoles.includes(role)) {
    const homePath = dashMap[role] || "/login";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold text-foreground">Access Denied</h1>
          <p className="text-muted-foreground text-sm">You don't have permission to view this page.</p>
          <Button asChild variant="outline">
            <Link to={homePath}>Go to your dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
