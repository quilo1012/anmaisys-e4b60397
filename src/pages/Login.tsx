import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Activity, Factory, Loader2 } from "lucide-react";
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

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: role } = await supabase.rpc("get_user_role", { _user_id: user.id });
        logAuditEvent("login", "user", user.id, { email: user.email, role: role || "unknown" });
        navigate(dashMap[role as string] || "/dashboard/manager", { replace: true });
      }
    } catch (error: any) {
      toast({
        title: "Sign-in failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen w-full bg-[hsl(222_47%_8%)] text-white">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
        {/* ── Brand panel ─────────────────────────────────── */}
        <aside
          className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex"
          style={{
            background:
              "linear-gradient(135deg, hsl(214 80% 18%) 0%, hsl(217 70% 12%) 55%, hsl(222 47% 8%) 100%)",
          }}
        >
          {/* decorative grid */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(hsl(0 0% 100% / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.6) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />
          {/* glow */}
          <div className="pointer-events-none absolute -top-32 -right-32 h-[420px] w-[420px] rounded-full bg-[hsl(210_100%_55%)] opacity-20 blur-[120px]" />
          <div className="pointer-events-none absolute -bottom-32 -left-32 h-[380px] w-[380px] rounded-full bg-[hsl(38_92%_50%)] opacity-10 blur-[120px]" />

          <header className="relative flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20 backdrop-blur">
              <img src={appliedLogo} alt="Applied Nutrition" className="h-7 w-7 rounded object-contain" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-white">APPLIED NUTRITION</p>
              <p className="text-xs uppercase tracking-[0.18em] text-white/55">Industrial Operations</p>
            </div>
          </header>

          <div className="relative space-y-8">
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-amber-400/90">
                Maintenance Intelligence Platform
              </p>
              <h1 className="text-4xl font-bold leading-tight tracking-tight xl:text-5xl">
                Keep every line <span className="text-amber-400">running.</span>
                <br />
                Every minute <span className="text-amber-400">accountable.</span>
              </h1>
              <p className="mt-5 max-w-md text-base leading-relaxed text-white/70">
                Real-time work orders, downtime tracking and asset reliability across the entire factory floor.
              </p>
            </div>

            <ul className="grid max-w-md gap-3 text-sm">
              <li className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur">
                <Activity className="h-4 w-4 text-amber-400" />
                <span className="text-white/85">Live downtime &amp; SLA monitoring</span>
              </li>
              <li className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur">
                <Factory className="h-4 w-4 text-amber-400" />
                <span className="text-white/85">Asset history &amp; predictive risk</span>
              </li>
              <li className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur">
                <ShieldCheck className="h-4 w-4 text-amber-400" />
                <span className="text-white/85">Role-based access &amp; full audit trail</span>
              </li>
            </ul>
          </div>

          <footer className="relative flex items-center justify-between text-xs text-white/45">
            <span>© {year} Applied Nutrition Ltd.</span>
            <span className="tracking-wide">v1.0 · Production</span>
          </footer>
        </aside>

        {/* ── Form panel ──────────────────────────────────── */}
        <main className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">
            {/* mobile logo */}
            <div className="mb-8 flex flex-col items-center lg:hidden">
              <img src={appliedLogo} alt="Applied Nutrition" className="h-20 w-auto rounded-xl object-contain" />
              <p className="mt-3 text-xs uppercase tracking-[0.2em] text-white/55">
                Industrial Operations
              </p>
            </div>

            <div className="mb-8">
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Welcome back
              </h2>
              <p className="mt-2 text-sm text-white/60">
                Sign in with your corporate credentials to continue.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
              <div className="space-y-2">
                <label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-white/60">
                  Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@appliednutrition.com"
                    required
                    autoComplete="new-password"
                    className="h-12 w-full rounded-lg border border-white/15 bg-white/[0.04] pl-11 pr-4 text-sm text-white transition-all placeholder:text-white/35 hover:border-white/25 focus:border-amber-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-white/60">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    required
                    autoComplete="new-password"
                    className="h-12 w-full rounded-lg border border-white/15 bg-white/[0.04] pl-11 pr-12 text-sm text-white transition-all placeholder:text-white/35 hover:border-white/25 focus:border-amber-500/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-white/45 transition-colors hover:text-white/80"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group relative inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-b from-[hsl(214_85%_52%)] to-[hsl(214_85%_42%)] text-sm font-semibold text-white shadow-lg shadow-blue-900/40 ring-1 ring-white/10 transition-all hover:from-[hsl(214_85%_56%)] hover:to-[hsl(214_85%_46%)] hover:shadow-blue-900/60 disabled:pointer-events-none disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                  </>
                ) : (
                  "Sign In"
                )}
              </button>

              <div className="flex items-center gap-3 pt-2 text-[11px] text-white/45">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80" />
                <span>Secured connection · Audited access</span>
              </div>
            </form>

            <p className="mt-10 text-center text-xs text-white/35 lg:hidden">
              © {year} Applied Nutrition Ltd. · v1.0
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
