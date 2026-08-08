import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";

const inputCls =
  "h-11 w-full rounded-lg border border-auth-ink/15 bg-auth-ink/5 pl-10 pr-4 text-sm text-auth-ink transition-all placeholder:text-auth-ink-muted hover:border-auth-ink/15 focus:border-auth-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-auth-brand/20";
const primaryBtn =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[hsl(var(--auth-brand))] text-sm font-semibold text-white transition-colors hover:bg-[hsl(var(--auth-brand) / 0.85)] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60";
const ghostBtn =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-auth-ink/15 bg-white text-sm font-medium text-auth-ink transition-colors hover:bg-auth-ink/5";

export default function ResetPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [ready, setReady] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    if (params.get("type") === "recovery") setRecoveryMode(true);
    setReady(true);
  }, []);

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast({ title: "Enter your email", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSent(true);
      toast({ title: "Recovery email sent", description: "Check your inbox for the password reset link." });
    } catch (error: any) {
      toast({ title: "Could not send recovery email", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 6) {
      toast({ title: "Password too short", description: "Your new password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: "Password updated", description: "You can now sign in with your new password." });
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (error: any) {
      toast({ title: "Could not update password", description: error.message, variant: "destructive" });
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <AuthShell title="Reset password" subtitle="Verifying your recovery link…">
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-auth-ink-muted" />
        </div>
      </AuthShell>
    );
  }

  const recoveryBadge = (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-2xs font-medium uppercase tracking-wider text-success-strong ring-1 ring-success sm:gap-1.5">
      <KeyRound className="h-3 w-3" /> Recovery
    </span>
  );

  if (recoveryMode) {
    return (
      <AuthShell badge={recoveryBadge} title="Set new password" subtitle="Create a new password for your account.">
        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-password" className="text-sm font-medium text-auth-ink">New password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-auth-ink-muted" />
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                required
                autoComplete="new-password"
                autoFocus
                className={inputCls + " pr-11"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-auth-ink-muted transition-colors hover:text-auth-ink"
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="pl-1 text-2xs text-auth-ink-muted">Minimum 6 characters.</p>
          </div>

          <button type="submit" disabled={loading} className={primaryBtn}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Updating…</> : <><CheckCircle2 className="h-4 w-4" /> Update password</>}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset password" subtitle="Enter your email and we'll send you a recovery link.">
      {sent ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-success/30 bg-success/10 p-4 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-success-strong" />
            <h3 className="mt-2 text-sm font-medium text-auth-ink">Recovery email sent</h3>
            <p className="mt-1 text-xs text-auth-ink">
              Check your inbox for the password reset link. If it doesn't arrive, check your spam folder.
            </p>
          </div>
          <button type="button" onClick={() => navigate("/login", { replace: true })} className={ghostBtn}>
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={handleSendLink} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="text-sm font-medium text-auth-ink">Email</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-auth-ink-muted" />
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@appliednutrition.com"
                required
                autoComplete="email"
                autoFocus
                className={inputCls}
              />
            </div>
          </div>

          <button type="submit" disabled={loading} className={primaryBtn}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><Mail className="h-4 w-4" /> Send recovery link</>}
          </button>

          <button
            type="button"
            onClick={() => navigate("/login", { replace: true })}
            className="flex w-full items-center justify-center gap-2 text-xs text-auth-ink-muted transition-colors hover:text-auth-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </button>
        </form>
      )}
    </AuthShell>
  );
}
