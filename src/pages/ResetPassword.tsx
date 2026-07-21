import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Loader2, ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";

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

  // Detect recovery hash from Supabase magic link.
  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const type = params.get("type");
    if (type === "recovery") {
      setRecoveryMode(true);
    }
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
      toast({
        title: "Recovery email sent",
        description: "Check your inbox for the password reset link.",
      });
    } catch (error: any) {
      toast({
        title: "Could not send recovery email",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 6) {
      toast({
        title: "Password too short",
        description: "Your new password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({
        title: "Password updated",
        description: "You can now sign in with your new password.",
      });
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (error: any) {
      toast({
        title: "Could not update password",
        description: error.message,
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <AuthShell title="Reset password" subtitle="Verifying your recovery link…">
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-white/70" />
        </div>
      </AuthShell>
    );
  }

  const recoveryBadge = (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-400/25 sm:gap-1.5">
      <KeyRound className="h-3 w-3" /> Recovery
    </span>
  );

  if (recoveryMode) {
    return (
      <AuthShell badge={recoveryBadge} title="Set new password" subtitle="Create a new password for your account.">
        <form onSubmit={handleUpdatePassword} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="new-password" className="text-[11px] font-medium uppercase tracking-wider text-white/55">
              New password
            </label>
            <div className="group relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-amber-400" />
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
                className="h-12 sm:h-14 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-12 text-sm text-white transition-all placeholder:text-white/30 hover:border-white/20 focus:border-amber-500/60 focus:bg-white/[0.07] focus:outline-none focus:ring-4 focus:ring-amber-500/15"
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
            <p className="pl-1 text-[11px] text-white/45">Minimum 6 characters.</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative inline-flex h-12 sm:h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-b from-[hsl(214_90%_56%)] to-[hsl(214_90%_44%)] text-sm font-semibold text-white shadow-[0_10px_30px_-10px_hsl(214_90%_50%/0.7)] ring-1 ring-white/10 transition-all hover:from-[hsl(214_90%_60%)] hover:to-[hsl(214_90%_48%)] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Updating…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" /> Update password
              </>
            )}
          </button>

          <div className="flex items-center justify-center gap-2 text-[11px] text-white/45">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80" />
            <span>Encrypted connection · Audited access</span>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset password" subtitle="Enter your email and we'll send you a recovery link.">
      {sent ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] p-4 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
            <h3 className="mt-2 text-sm font-medium text-white">Recovery email sent</h3>
            <p className="mt-1 text-xs text-white/60">
              Check your inbox for the password reset link. If it doesn't arrive, check your spam folder.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/login", { replace: true })}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-medium text-white/85 transition-colors hover:bg-white/[0.07]"
          >
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={handleSendLink} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="text-[11px] font-medium uppercase tracking-wider text-white/55">
              Email
            </label>
            <div className="group relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-amber-400" />
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@appliednutrition.com"
                required
                autoComplete="email"
                autoFocus
                className="h-12 sm:h-14 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-4 text-sm text-white transition-all placeholder:text-white/30 hover:border-white/20 focus:border-amber-500/60 focus:bg-white/[0.07] focus:outline-none focus:ring-4 focus:ring-amber-500/15"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative inline-flex h-12 sm:h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-b from-[hsl(214_90%_56%)] to-[hsl(214_90%_44%)] text-sm font-semibold text-white shadow-[0_10px_30px_-10px_hsl(214_90%_50%/0.7)] ring-1 ring-white/10 transition-all hover:from-[hsl(214_90%_60%)] hover:to-[hsl(214_90%_48%)] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Mail className="h-4 w-4" /> Send recovery link
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => navigate("/login", { replace: true })}
            className="flex w-full items-center justify-center gap-2 text-[12px] text-white/55 transition-colors hover:text-white/85"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </button>

          <div className="flex items-center justify-center gap-2 text-[11px] text-white/45">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80" />
            <span>Encrypted connection · Audited access</span>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
