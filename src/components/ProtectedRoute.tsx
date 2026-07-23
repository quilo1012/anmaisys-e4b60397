import { Navigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { Loader2, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { can, roleDashMap, subscribePermissionOverrides, subscribeMobileHidden, isMobileHidden, type Action } from "@/lib/permissions";
import { useIsMobile } from "@/hooks/use-mobile";

type AppRole = Database["public"]["Enums"]["app_role"];

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
  requiredAction?: Action;
}

export function ProtectedRoute({ children, allowedRoles, requiredAction }: ProtectedRouteProps) {
  const { session, role, profile, loading, authError, silentReLoginInFlight, retryAuth, signOut } = useAuth();
  const [, setPermissionVersion] = useState(0);
  const isMobile = useIsMobile();

  useEffect(() => {
    const a = subscribePermissionOverrides(() => setPermissionVersion((v) => v + 1));
    const b = subscribeMobileHidden(() => setPermissionVersion((v) => v + 1));
    return () => { a(); b(); };
  }, []);

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
          <img src="/favicon.png" alt="" aria-hidden="true" className="h-12 w-12 rounded-xl object-contain shadow-lg ring-1 ring-white/10" />
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
          <img src="/favicon.png" alt="" aria-hidden="true" className="h-12 w-12 rounded-xl object-contain shadow-lg ring-1 ring-white/10" />
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

  // Account inactive — block immediately, even before role resolves.
  // A self-registered account that was never approved (no role yet) shows a
  // friendlier "pending approval" message instead of "deactivated".
  if (profile && profile.active === false) {
    const pendingApproval = !role;
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center space-y-4 max-w-md">
          <ShieldAlert className={`mx-auto h-12 w-12 ${pendingApproval ? "text-amber-500" : "text-destructive"}`} />
          <h1 className="text-xl font-semibold text-foreground">
            {pendingApproval ? "Waiting for approval" : "Account deactivated"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {pendingApproval
              ? "Your account was created and is waiting for an administrator to approve it and assign your role. You'll get access once approved."
              : "Your account has been disabled. Please contact your supervisor to regain access."}
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
          <img src="/favicon.png" alt="" aria-hidden="true" className="h-12 w-12 rounded-xl object-contain shadow-lg ring-1 ring-white/10" />
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="text-sm">Loading permissions…</span>
        </div>
      </div>
    );
  }

  // Role loaded — evaluate access.
  // Rules (unified with Permissions Matrix):
  //   1. admin always passes (no self-lockout).
  //   2. co_engineer inherits engineer.
  //   3. When requiredAction is set, gate SOLELY by can(role, action) —
  //      allowedRoles is ignored so we never create an AND-lockout.
  //   4. Otherwise fall back to allowedRoles (used by routes that intentionally
  //      have no matching action, e.g. warehouse and *-preview pages).
  const effectiveRole = role === "co_engineer" ? "engineer" : role;
  let denied = false;
  if (effectiveRole !== "admin") {
    if (requiredAction) {
      denied = !can(effectiveRole, requiredAction);
    } else if (allowedRoles) {
      denied = !allowedRoles.includes(effectiveRole);
    }
  }
  if (denied) {
    const homePath = roleDashMap[role] || "/login";
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

  // Mobile visibility: an admin may hide specific screens on mobile (role_mobile_hidden),
  // even for roles that otherwise have access (including admin). Block direct navigation.
  if (isMobile && requiredAction && role && isMobileHidden(effectiveRole, requiredAction)) {
    const homePath = roleDashMap[role] || "/login";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="text-center space-y-4">
          <ShieldAlert className="mx-auto h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold text-foreground">Not available on mobile</h1>
          <p className="text-muted-foreground text-sm">This screen is only available on a computer. Please use a desktop.</p>
          <Button asChild variant="outline">
            <Link to={homePath}>Go to your dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
