import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Loader2, ArrowRight, Tablet, User as UserIcon } from "lucide-react";
import appliedLogo from "@/assets/appliedlogo.jpeg";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import { useAuth } from "@/contexts/AuthContext";
import { useOperatorAccounts } from "@/hooks/useOperatorAccounts";
import { useLines } from "@/hooks/useMachines";

const dashMap: Record<string, string> = {
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",
  engineer: "/dashboard/engineer",
  operator: "/dashboard/operator",
};

const MODE_KEY = "an_login_mode";
const TABLET_KEY = "an_tablet_account_id";
// Persisted credentials used to silently re-login a Tablet account whose
// refresh-token was revoked (e.g. the same shared account refreshing on
// another tablet). Scoped to Tablet mode only — never used for staff.
const TABLET_CRED_KEY = "an_tablet_cred";

type Mode = "staff" | "tablet";

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, role, loading: authLoading } = useAuth();
  const { data: operatorAccounts, isLoading: accountsLoading } = useOperatorAccounts();
  const { data: lines } = useLines();

  // ── Mode state (Staff vs Tablet) ────────────────────────────
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined") return "staff";
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "tablet" ? "tablet" : "staff";
  });

  // ── Form state ──────────────────────────────────────────────
  const [email, setEmail] = useState("");
  const [tabletAccountId, setTabletAccountId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(TABLET_KEY) ?? "";
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Hide toggle if no operator accounts exist (clean slate for first install)
  const hasOperatorAccounts = (operatorAccounts?.length ?? 0) > 0;

  // If user is in Tablet mode but no accounts exist, fall back to Staff
  useEffect(() => {
    if (mode === "tablet" && !accountsLoading && !hasOperatorAccounts) {
      setMode("staff");
    }
  }, [mode, accountsLoading, hasOperatorAccounts]);

  // Validate stored tablet selection still exists; clear if it doesn't
  useEffect(() => {
    if (!operatorAccounts) return;
    if (tabletAccountId && !operatorAccounts.some((a) => a.id === tabletAccountId)) {
      setTabletAccountId("");
      localStorage.removeItem(TABLET_KEY);
    }
  }, [operatorAccounts, tabletAccountId]);

  // Redirect when authenticated
  useEffect(() => {
    if (!authLoading && session && role) {
      navigate(dashMap[role] || "/dashboard/manager", { replace: true });
    }
  }, [authLoading, navigate, role, session]);

  const lineNameMap = useMemo(() => {
    const m = new Map<string, string>();
    lines?.forEach((l) => m.set(l.id, l.name));
    return m;
  }, [lines]);

  const selectedAccount = operatorAccounts?.find((a) => a.id === tabletAccountId) ?? null;

  const switchMode = (next: Mode) => {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let loginEmail: string;
    if (mode === "tablet") {
      if (!selectedAccount) {
        toast({ title: "Select your tablet", variant: "destructive" });
        return;
      }
      loginEmail = selectedAccount.email.trim().toLowerCase();
    } else {
      loginEmail = email.trim().toLowerCase();
      if (!loginEmail) {
        toast({ title: "Enter your email", variant: "destructive" });
        return;
      }
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (error) throw error;

      // Persist mode + tablet selection on success
      localStorage.setItem(MODE_KEY, mode);
      if (mode === "tablet" && selectedAccount) {
        localStorage.setItem(TABLET_KEY, selectedAccount.id);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: roleResult } = await supabase.rpc("get_user_role", { _user_id: user.id });
        logAuditEvent("login", "user", user.id, {
          email: user.email,
          role: roleResult || "unknown",
          mode,
        });
        navigate(dashMap[roleResult as string] || "/dashboard/manager", { replace: true });
      }
    } catch (error: any) {
      toast({ title: "Sign-in failed", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const year = new Date().getFullYear();

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[hsl(222_47%_6%)] text-white">
      {/* ── Cinematic background ─────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 18% 25%, hsl(214 90% 22% / 0.55) 0%, transparent 60%)," +
            "radial-gradient(50% 45% at 85% 80%, hsl(38 92% 45% / 0.18) 0%, transparent 65%)," +
            "radial-gradient(80% 60% at 50% 100%, hsl(214 80% 14% / 0.6) 0%, transparent 70%)," +
            "linear-gradient(180deg, hsl(222 47% 7%) 0%, hsl(222 50% 5%) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(0 0% 100% / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_70%,hsl(222_55%_4%/0.7)_100%)]" />

      {/* ── Center card ─────────────────────────────────── */}
      <main className="relative z-10 flex min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-[440px]">
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(214_100%_55%)] opacity-20 blur-[140px]" />

          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur-2xl sm:p-10">
            {/* Brand */}
            <div className="mb-6 flex flex-col items-center text-center">
              <img
                src={appliedLogo}
                alt="Applied Nutrition"
                className="mb-4 w-full h-auto object-contain"
              />
            </div>

            {/* Mode toggle — only when there's at least one operator account */}
            {hasOperatorAccounts && (
              <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                <button
                  type="button"
                  onClick={() => switchMode("staff")}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                    mode === "staff"
                      ? "bg-white/[0.08] text-white shadow-sm ring-1 ring-white/15"
                      : "text-white/50 hover:text-white/80"
                  }`}
                >
                  <UserIcon className="h-3.5 w-3.5" />
                  Staff
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("tablet")}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                    mode === "tablet"
                      ? "bg-white/[0.08] text-white shadow-sm ring-1 ring-white/15"
                      : "text-white/50 hover:text-white/80"
                  }`}
                >
                  <Tablet className="h-3.5 w-3.5" />
                  Tablet
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
              {mode === "tablet" ? (
                /* ── Tablet selector ─────────────────────────── */
                <div className="space-y-1.5">
                  <label htmlFor="tablet" className="text-[11px] font-medium uppercase tracking-wider text-white/55">
                    Tablet / Line
                  </label>
                  <div className="group relative">
                    <Tablet className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-amber-400" />
                    <select
                      id="tablet"
                      value={tabletAccountId}
                      onChange={(e) => setTabletAccountId(e.target.value)}
                      required
                      className="h-12 w-full appearance-none rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-4 text-sm text-white transition-all hover:border-white/20 focus:border-amber-500/60 focus:bg-white/[0.07] focus:outline-none focus:ring-4 focus:ring-amber-500/15"
                    >
                      <option value="" disabled className="bg-[hsl(222_47%_10%)] text-white">
                        Select your tablet…
                      </option>
                      {operatorAccounts?.map((acc) => {
                        const lineNames = acc.line_ids
                          .map((id) => lineNameMap.get(id))
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <option key={acc.id} value={acc.id} className="bg-[hsl(222_47%_10%)] text-white">
                            {acc.label}
                            {lineNames ? ` — ${lineNames}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {selectedAccount && (
                    <p className="pl-1 text-[11px] text-white/45">
                      Signed-in as{" "}
                      <span className="font-mono text-white/60">{selectedAccount.email}</span>
                    </p>
                  )}
                </div>
              ) : (
                /* ── Staff email ─────────────────────────────── */
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-[11px] font-medium uppercase tracking-wider text-white/55">
                    Email
                  </label>
                  <div className="group relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-amber-400" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@appliednutrition.com"
                      required
                      autoComplete="new-password"
                      className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-4 text-sm text-white transition-all placeholder:text-white/30 hover:border-white/20 focus:border-amber-500/60 focus:bg-white/[0.07] focus:outline-none focus:ring-4 focus:ring-amber-500/15"
                    />
                  </div>
                </div>
              )}

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-[11px] font-medium uppercase tracking-wider text-white/55">
                  Password
                </label>
                <div className="group relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-amber-400" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    required
                    autoComplete="new-password"
                    className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-12 text-sm text-white transition-all placeholder:text-white/30 hover:border-white/20 focus:border-amber-500/60 focus:bg-white/[0.07] focus:outline-none focus:ring-4 focus:ring-amber-500/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-white/45 transition-colors hover:text-white/85"
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
                disabled={loading}
                className="group relative mt-2 inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-b from-[hsl(214_90%_56%)] to-[hsl(214_90%_44%)] text-sm font-semibold text-white shadow-[0_10px_30px_-10px_hsl(214_90%_50%/0.7)] ring-1 ring-white/10 transition-all hover:from-[hsl(214_90%_60%)] hover:to-[hsl(214_90%_48%)] hover:shadow-[0_14px_36px_-10px_hsl(214_90%_55%/0.8)] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                  </>
                ) : (
                  <>
                    Sign In <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>

              {/* Security badge */}
              <div className="mt-1 flex items-center justify-center gap-2 pt-2 text-[11px] text-white/45">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80" />
                <span>Encrypted connection · Audited access</span>
              </div>
            </form>
          </div>

          <p className="mt-6 text-center text-[11px] text-white/35">
            © {year} Applied Nutrition Ltd. · Maintenance Platform v1.0
          </p>
        </div>
      </main>
    </div>
  );
}
