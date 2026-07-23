import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowRight, Tablet, User as UserIcon, ShieldAlert, CheckCircle2 } from "lucide-react";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import { useAuth } from "@/contexts/AuthContext";
import { usePublicTabletAccounts } from "@/hooks/useOperatorAccounts";
import { invokeFunction } from "@/lib/invokeFunction";
import { useLines } from "@/hooks/useMachines";
import { roleDashMap, type Role } from "@/lib/permissions";
import { useLoginBranding } from "@/hooks/useLoginBranding";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  clearLoginLockout,
  getLoginLockout,
  recordLoginFailure,
} from "@/lib/loginRateLimit";


// Landing route per role — use the shared source of truth so login never sends a
// role to a page it can't access (previously a stale local map dropped roles like
// quality_supervisor onto /dashboard/manager → Access Denied).
const landingFor = (role: string | null | undefined) =>
  (role && roleDashMap[role as Role]) || "/login";

const MODE_KEY = "an_login_mode";
const TABLET_KEY = "an_tablet_account_id";
const TABLET_TS_KEY = "an_tablet_account_id_at";
// Tablet selection auto-clears after one shift (8 hours) so a tablet left
// idle overnight forces a fresh pick instead of silently re-using yesterday's.
const TABLET_SELECTION_TTL_MS = 8 * 60 * 60 * 1000;
// Persisted credentials used to silently re-login a Tablet account whose
// refresh-token was revoked (e.g. the same shared account refreshing on
// another tablet). Scoped to Tablet mode only — never used for staff.
const TABLET_CRED_KEY = "an_tablet_cred";

function getStoredTabletId(): string {
  if (typeof window === "undefined") return "";
  const id = localStorage.getItem(TABLET_KEY);
  if (!id) return "";
  const tsRaw = localStorage.getItem(TABLET_TS_KEY);
  const ts = tsRaw ? Number(tsRaw) : 0;
  if (!ts || Date.now() - ts > TABLET_SELECTION_TTL_MS) {
    localStorage.removeItem(TABLET_KEY);
    localStorage.removeItem(TABLET_TS_KEY);
    return "";
  }
  return id;
}

type Mode = "staff" | "tablet";

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Consent flow (and other deep-links) preserve where to send the user
  // after sign-in. Only same-origin relative paths are honored.
  const nextParam = searchParams.get("next");
  const safeNext = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;
  const { toast } = useToast();
  const { session, role, loading: authLoading } = useAuth();
  const { data: operatorAccounts, isLoading: accountsLoading } = usePublicTabletAccounts();
  const { data: lines } = useLines();
  const { data: branding } = useLoginBranding();

  // ── Mode state (Staff vs Tablet) ────────────────────────────
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined") return "staff";
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "tablet" ? "tablet" : "staff";
  });

  // ── Form state ──────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [tabletAccountId, setTabletAccountId] = useState<string>(() => getStoredTabletId());
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState(false);

  // ── Rate limit state ────────────────────────────────────────
  // Identity used as the rate-limit key (email or tablet account id).
  const rlId = mode === "tablet" ? tabletAccountId : email.trim().toLowerCase();
  const [lockedMsLeft, setLockedMsLeft] = useState(0);
  const [remaining, setRemaining] = useState(5);

  // Refresh lockout status every second while a lockout is active.
  useEffect(() => {
    const sync = () => {
      const s = getLoginLockout(rlId);
      setLockedMsLeft(s.lockedMsLeft);
      setRemaining(s.remaining);
    };
    sync();
    if (!rlId) return;
    const t = window.setInterval(sync, 1000);
    return () => window.clearInterval(t);
  }, [rlId]);

  // Always show the toggle. If the tablet list is still loading or temporarily
  // empty (e.g. RLS hiccup), the TABLET tab simply shows a loading/empty state
  // instead of silently flipping the user back to STAFF.
  const hasOperatorAccounts = (operatorAccounts?.length ?? 0) > 0;

  // Validate stored tablet selection still exists; clear if it doesn't
  useEffect(() => {
    if (!operatorAccounts) return;
    if (tabletAccountId && !operatorAccounts.some((a) => a.id === tabletAccountId)) {
      setTabletAccountId("");
      localStorage.removeItem(TABLET_KEY);
      localStorage.removeItem(TABLET_TS_KEY);
    }
  }, [operatorAccounts, tabletAccountId]);

  // Redirect when authenticated
  useEffect(() => {
    if (!authLoading && session && role) {
      if (safeNext) {
        window.location.href = safeNext;
        return;
      }
      navigate(landingFor(role), { replace: true });
    }
  }, [authLoading, navigate, role, session, safeNext]);

  const lineNameMap = useMemo(() => {
    const m = new Map<string, string>();
    lines?.forEach((l) => m.set(l.id, l.name));
    return m;
  }, [lines]);

  const selectedAccount = operatorAccounts?.find((a) => a.id === tabletAccountId) ?? null;

  // Reflect the active per-tablet / per-mode favicon in the browser tab too,
  // not just inside the card. Restores the default on unmount.
  useEffect(() => {
    const url =
      (mode === "tablet" && selectedAccount?.favicon_url) ||
      branding?.[mode]?.url ||
      "/favicon.png";
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    const previous = link?.href;
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = url;
    return () => {
      if (link && previous) link.href = previous;
    };
  }, [mode, selectedAccount?.favicon_url, branding]);

  const switchMode = (next: Mode) => {
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ }
    // Clear password and any prior identity so switching tabs feels clean.
    setPassword("");
    if (next === "staff") {
      setTabletAccountId("");
    } else {
      setEmail("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "tablet" && !selectedAccount) {
      toast({ title: "Select your tablet", variant: "destructive" });
      return;
    }
    if (mode === "staff" && !email.trim()) {
      toast({ title: "Enter your email", variant: "destructive" });
      return;
    }

    // Block while locked out.
    const pre = getLoginLockout(rlId);
    if (pre.lockedMsLeft > 0) {
      toast({
        title: "Too many attempts",
        description: `Try again in ${Math.ceil(pre.lockedMsLeft / 1000)}s`,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      if (mode === "tablet" && selectedAccount) {
        // Tablet sign-in goes through the edge function so the email is never
        // sent to the browser. The function resolves the email server-side and
        // returns only session tokens.
        const { data, error } = await invokeFunction<{
          access_token: string;
          refresh_token: string;
        }>("tablet-signin", {
          account_id: selectedAccount.id,
          password,
        });
        if (error) throw error;
        if (!data?.access_token || !data?.refresh_token) {
          throw new Error("Invalid credentials");
        }
        const { error: setErr } = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        if (setErr) throw setErr;
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
      }

      // Success — wipe the rate-limit counter for this identity.
      clearLoginLockout(rlId);
      setAuthed(true);
      toast({ title: "Signed in", description: "Redirecting to your dashboard…" });


      // Persist mode + tablet selection on success
      localStorage.setItem(MODE_KEY, mode);
      if (mode === "tablet" && selectedAccount) {
        localStorage.setItem(TABLET_KEY, selectedAccount.id);
        localStorage.setItem(TABLET_TS_KEY, String(Date.now()));
        // Persist refresh_token (NOT the password) for silent re-login on
        // token revocation. Only ever stored for shared Tablet operator accounts.
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.refresh_token) {
            localStorage.setItem(
              TABLET_CRED_KEY,
              JSON.stringify({ accountId: selectedAccount.id, refresh_token: session.refresh_token }),
            );
          }
        } catch {
          // localStorage may be unavailable; silent re-login simply won't run.
        }
      } else {
        // Staff login should never leave tablet credentials behind.
        localStorage.removeItem(TABLET_CRED_KEY);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: roleResult } = await supabase.rpc("get_user_role", { _user_id: user.id });
        logAuditEvent("login", "user", user.id, {
          role: roleResult || "unknown",
          mode,
        });
        if (safeNext) {
          window.location.href = safeNext;
          return;
        }
        navigate(landingFor(roleResult as string), { replace: true });
      }
    } catch (error: any) {
      // Count this failure and surface remaining attempts / lockout.
      const after = recordLoginFailure(rlId);
      setLockedMsLeft(after.lockedMsLeft);
      setRemaining(after.remaining);
      const description = after.lockedMsLeft > 0
        ? `Too many attempts — locked for ${Math.ceil(after.lockedMsLeft / 1000)}s.`
        : `${error.message}${after.remaining > 0 ? ` · ${after.remaining} attempt${after.remaining === 1 ? "" : "s"} remaining` : ""}`;
      toast({ title: "Sign-in failed", description, variant: "destructive" });
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  };


  const brandIconUrl =
    (mode === "tablet" && selectedAccount?.favicon_url) ||
    branding?.[mode]?.url ||
    "/favicon.png";

  return (
    <AuthShell
      brandIconUrl={brandIconUrl}
      title="Welcome"
      subtitle="Sign in to access the system"
    >
      {/* Staff / Tablet segmented control */}
      <div className="mb-6 grid grid-cols-2 gap-1 rounded-full border border-slate-200 bg-slate-100/80 p-1">
        <button
          type="button"
          onClick={() => switchMode("staff")}
          aria-pressed={mode === "staff"}
          className={`flex items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/30 ${
            mode === "staff"
              ? "bg-white text-[#1E3A8A] shadow-sm ring-1 ring-slate-200"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <UserIcon className="h-3.5 w-3.5" />
          Staff
        </button>
        <button
          type="button"
          onClick={() => switchMode("tablet")}
          aria-pressed={mode === "tablet"}
          className={`flex items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A8A]/30 ${
            mode === "tablet"
              ? "bg-white text-[#1E3A8A] shadow-sm ring-1 ring-slate-200"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Tablet className="h-3.5 w-3.5" />
          Tablet
        </button>
      </div>

      <form
        onSubmit={handleSubmit}
        className={`space-y-4 ${loading || authed ? "pointer-events-none opacity-70" : ""}`}
        autoComplete="on"
        aria-busy={loading}
      >
        {mode === "tablet" ? (
          /* ── Tablet selector ─────────────────────────── */
          <div className="space-y-1.5">
            <label htmlFor="tablet" className="text-sm font-medium text-slate-700">
              Tablet / Line
            </label>
            <div className="relative">
              <Tablet className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                id="tablet"
                value={tabletAccountId}
                onChange={(e) => setTabletAccountId(e.target.value)}
                required
                className="h-11 w-full appearance-none rounded-lg border border-slate-300 bg-slate-50 pl-10 pr-4 text-sm text-slate-900 transition-all hover:border-slate-400 focus:border-[#1E3A8A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
              >
                <option value="" disabled>
                  {accountsLoading ? "Loading tablets…" : hasOperatorAccounts ? "Select your tablet…" : "No tablets configured"}
                </option>
                {operatorAccounts?.map((acc) => {
                  const lineNames = acc.line_ids
                    .map((id) => lineNameMap.get(id))
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <option key={acc.id} value={acc.id}>
                      {acc.label}
                      {lineNames ? ` — ${lineNames}` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        ) : (
          /* ── Staff email ─────────────────────────────── */
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@appliednutrition.com"
                required
                autoComplete="email"
                className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 pl-10 pr-4 text-sm text-slate-900 transition-all placeholder:text-slate-400 hover:border-slate-400 focus:border-[#1E3A8A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
              />
            </div>
          </div>
        )}

        {/* Password */}
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-slate-700">
            Password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              required
              autoComplete="current-password"
              className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 pl-10 pr-11 text-sm text-slate-900 transition-all placeholder:text-slate-400 hover:border-slate-400 focus:border-[#1E3A8A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E3A8A]/20"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 transition-colors hover:text-slate-700"
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || authed || lockedMsLeft > 0}
          aria-live="polite"
          className={`mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white transition-all active:scale-[0.99] disabled:pointer-events-none ${
            authed
              ? "bg-emerald-600"
              : "bg-[#1E3A8A] hover:bg-[#1E40AF] disabled:opacity-60"
          }`}
        >
          {lockedMsLeft > 0 ? (
            <>
              <ShieldAlert className="h-4 w-4" /> Locked — wait {Math.ceil(lockedMsLeft / 1000)}s
            </>
          ) : authed ? (
            <>
              <CheckCircle2 className="h-5 w-5" /> Signed in · Redirecting…
            </>
          ) : loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
            </>
          ) : (
            <>
              Sign In <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        {/* Remaining-attempts hint */}
        {lockedMsLeft === 0 && remaining < 5 && (
          <p className="pt-1 text-center text-[11px] text-amber-600">
            {remaining} attempt{remaining === 1 ? "" : "s"} remaining before lockout
          </p>
        )}
      </form>
      {mode === "staff" && (
        <p className="mt-4 text-center text-sm text-slate-500">
          Don't have an account?{" "}
          <button type="button" onClick={() => navigate("/signup")} className="font-semibold text-[#1E3A8A] hover:underline">
            Create account
          </button>
        </p>
      )}
    </AuthShell>
  );
}

