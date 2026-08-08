import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/auth/AuthShell";
import { Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";

export default function SignUp() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("code")?.trim() ?? ""; } catch { return ""; }
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Enter your name."); return; }
    if (!email.trim()) { setError("Enter your email."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (!code.trim()) { setError("Enter the invite code."); return; }

    setSubmitting(true);
    try {
      // 1) Validate the invite code server-side (without exposing it).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { data: ok, error: rpcErr } = await (supabase.rpc as any)("check_invite_code", { code: code.trim() });
      if (rpcErr) throw rpcErr;
      if (!ok) { setError("Invalid invite code, or sign-up is currently closed. Ask your admin."); setSubmitting(false); return; }

      // 2) Create the account. Lands PENDING (active=false, no role) via the DB trigger.
      const { error: signErr } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { name: name.trim(), self_signup: "true" },
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });
      if (signErr) throw signErr;
      // Don't leave a half-session around — the account still needs approval.
      await supabase.auth.signOut();
      setDone(true);
    } catch (err) {
      setError((err as Error).message || "Could not create the account.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <AuthShell title="Account created" subtitle="One more step">
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-success-strong" />
          <p className="text-sm text-auth-ink">
            Check your email to confirm your address, then wait for an administrator to approve your
            account and assign your role. You'll be able to sign in once approved.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full rounded-lg bg-[hsl(var(--auth-brand))] py-2.5 text-sm font-semibold text-white hover:bg-[hsl(var(--auth-brand))]/90"
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create account" subtitle="Register and wait for admin approval">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="su-name" className="text-sm font-medium text-auth-ink">Full name</label>
          <input id="su-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
            className="w-full rounded-lg border border-auth-ink/15 bg-white px-3 py-2.5 text-sm text-auth-ink placeholder:text-auth-ink-muted outline-none focus:border-auth-brand focus:ring-2 focus:ring-auth-brand/20" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="su-email" className="text-sm font-medium text-auth-ink">Email</label>
          <input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            className="w-full rounded-lg border border-auth-ink/15 bg-white px-3 py-2.5 text-sm text-auth-ink placeholder:text-auth-ink-muted outline-none focus:border-auth-brand focus:ring-2 focus:ring-auth-brand/20" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="su-pass" className="text-sm font-medium text-auth-ink">Password</label>
          <div className="relative">
            <input id="su-pass" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
              className="w-full rounded-lg border border-auth-ink/15 bg-white px-3 py-2.5 pr-10 text-sm text-auth-ink placeholder:text-auth-ink-muted outline-none focus:border-auth-brand focus:ring-2 focus:ring-auth-brand/20" />
            <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-auth-ink-muted hover:text-auth-ink" aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="su-code" className="text-sm font-medium text-auth-ink">Invite code</label>
          <input id="su-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off"
            placeholder="Ask your administrator"
            className="w-full rounded-lg border border-auth-ink/15 bg-white px-3 py-2.5 text-sm text-auth-ink placeholder:text-auth-ink-muted outline-none focus:border-auth-brand focus:ring-2 focus:ring-auth-brand/20" />
        </div>

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-strong">{error}</p>}

        <button type="submit" disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[hsl(var(--auth-brand))] py-2.5 text-sm font-semibold text-white hover:bg-[hsl(var(--auth-brand))]/90 disabled:opacity-60">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Create account
        </button>

        <p className="text-center text-sm text-auth-ink-muted">
          Already have an account? <Link to="/login" className="font-semibold text-[hsl(var(--auth-brand))] hover:underline">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
