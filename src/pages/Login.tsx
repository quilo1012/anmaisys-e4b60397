import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Loader2, ArrowRight } from "lucide-react";
import appliedLogo from "@/assets/appliedlogo.jpeg";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import { useAuth } from "@/contexts/AuthContext";

const dashMap: Record<string, string> = {
  admin: "/dashboard/manager",
  manager: "/dashboard/manager",
  engineer: "/dashboard/engineer",
  operator: "/dashboard/operator",
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, role, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && session && role) {
      navigate(dashMap[role] || "/dashboard/manager", { replace: true });
    }
  }, [authLoading, navigate, role, session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) throw error;
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: role } = await supabase.rpc("get_user_role", { _user_id: user.id });
        logAuditEvent("login", "user", user.id, { email: user.email, role: role || "unknown" });
        navigate(dashMap[role as string] || "/dashboard/manager", { replace: true });
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
      {/* grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(0 0% 100% / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
        }}
      />
      {/* soft vignette (subtle) */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_70%,hsl(222_55%_4%/0.7)_100%)]" />

      {/* ── Top bar ──────────────────────────────────────── */}
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 pt-6 sm:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/8 ring-1 ring-white/15 backdrop-blur">
            <img src={appliedLogo} alt="Applied Nutrition" className="h-7 w-7 rounded object-contain" />
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-semibold tracking-wide">APPLIED NUTRITION</p>
            <p className="text-[10px] uppercase tracking-[0.22em] text-white/45">Industrial Operations</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-medium text-emerald-300 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_hsl(142_70%_55%)]" />
          System Online
        </div>
      </header>

      {/* ── Center card ─────────────────────────────────── */}
      <main className="relative z-10 flex min-h-[calc(100vh-5rem)] items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-[440px]">
          {/* glow under card */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(214_100%_55%)] opacity-20 blur-[140px]" />

          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur-2xl sm:p-10">
            {/* Brand mark */}
            <div className="mb-7 flex flex-col items-center text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-white/10 to-white/[0.02] ring-1 ring-white/15">
                <img src={appliedLogo} alt="Applied Nutrition" className="h-11 w-11 rounded-lg object-contain" />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-400/90">
                Maintenance Platform
              </p>
              <h1 className="mt-2 text-[26px] font-semibold tracking-tight">Sign in to continue</h1>
              <p className="mt-1.5 text-sm text-white/55">
                Use your corporate credentials to access the system.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
              {/* Email */}
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
                <span
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                />
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
