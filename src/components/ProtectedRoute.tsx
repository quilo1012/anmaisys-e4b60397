import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

type AppRole = Database["public"]["Enums"]["app_role"];

const dashMap: Record<AppRole, string> = {
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",
  engineer: "/dashboard/engineer",
  operator: "/dashboard/operator",
  viewer: "/dashboard/manager",
};

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { session, role, profile, loading, silentReLoginInFlight, signOut } = useAuth();

  // Still resolving session or role — show spinner
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Silent re-login in progress (shared tablet refresh-token recovery) — wait
  // instead of bouncing the user to /login. The recovery completes within a
  // few hundred ms; if it fails, the next render will redirect normally.
  if (!session && silentReLoginInFlight) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
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
