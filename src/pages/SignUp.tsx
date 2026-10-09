import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  authField,
  authFieldAction,
  authInlineBtn,
  authLabel,
  authLink,
  authPrimaryBtn,
} from "@/components/auth/authStyles";
import { Loader2, CheckCircle2, Eye, EyeOff, BadgeCheck, Mail } from "lucide-react";
import { invokeFunction } from "@/lib/invokeFunction";
import { looksLikeEmployeeRef } from "@/lib/loginIdentity";

export default function SignUp() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Whether accounts from this link are active on creation (an operator who can answer
  // overtime) or wait for an admin. Read once, anonymously; it only changes the words.
  const [autoRole, setAutoRole] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
    (supabase.rpc as any)("self_signup_role").then(({ data }: { data: string | null }) => setAutoRole(data ?? null));
  }, []);
  const [code, setCode] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("code")?.trim() ?? ""; } catch { return ""; }
  });
  /** Whether the code came with the link, which decides what the field says about it. */
  const [fromLink] = useState(() => {
    try { return !!new URLSearchParams(window.location.search).get("code")?.trim(); } catch { return false; }
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  /**
   * Two doors. The badge is the default: everybody on the floor has one, few have an
   * email, and a badge number keys the account to the roster row in one step — no
   * confirmation mail, no approval queue, no "pick your name". Email stays for the
   * office and for anyone whose badge has no number on record yet.
   */
  const [door, setDoor] = useState<"badge" | "email">("badge");
  const [employeeRef, setEmployeeRef] = useState("");

  const submitBadge = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const ref = employeeRef.trim().toUpperCase();
    if (!looksLikeEmployeeRef(ref)) { setError("Enter the ID on your badge, like E045."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (!code.trim()) { setError("Enter the invite code."); return; }
    setSubmitting(true);
    try {
      const { data, error: fnErr } = await invokeFunction<{ access_token: string; refresh_token: string; full_name: string | null }>(
        "employee-signin", { mode: "register", employee_ref: ref, password, invite_code: code.trim() },
      );
      if (fnErr) throw fnErr;
      if (!data?.access_token || !data?.refresh_token) throw new Error("Could not create the account.");
      const { error: setErr } = await supabase.auth.setSession({
        access_token: data.access_token, refresh_token: data.refresh_token,
      });
      if (setErr) throw setErr;
      // Signed in and linked. Straight to the one screen this account is for.
      window.location.href = "/dashboard/my-overtime";
    } catch (err) {
      setError((err as Error).message || "Could not create the account.");
      setSubmitting(false);
    }
  };

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
      if (!ok) { setError("That invite code isn't valid any more — it may have expired, or sign-up is closed. Ask your supervisor for a new one."); setSubmitting(false); return; }

      // 2) Create the account. Lands PENDING (active=false, no role) via the DB trigger.
      const { error: signErr } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { name: name.trim(), self_signup: "true" },
          // An operator account is for one thing; land it there after the email click.
          emailRedirectTo: autoRole
            ? `${window.location.origin}/login?next=${encodeURIComponent("/dashboard/my-overtime")}`
            : `${window.location.origin}/login`,
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
            {autoRole
              ? <>Check your email and tap the confirmation link. Then sign in, pick your name once, and you're set — you'll be told whenever overtime opens.</>
              : <>Check your email to confirm your address, then wait for an administrator to approve your account and assign your role. You'll be able to sign in once approved.</>}
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className={authPrimaryBtn}
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create account" subtitle={door === "badge" ? "Use the ID on your badge" : "Register with your email"}>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-auth-line bg-auth-field p-1 text-sm">
        <button type="button" onClick={() => { setDoor("badge"); setError(""); }}
          className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 ${door === "badge" ? "bg-auth-paper font-medium text-auth-ink shadow-sm" : "text-auth-ink-muted"}`}>
          <BadgeCheck className="h-4 w-4" /> Employee ID
        </button>
        <button type="button" onClick={() => { setDoor("email"); setError(""); }}
          className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 ${door === "email" ? "bg-auth-paper font-medium text-auth-ink shadow-sm" : "text-auth-ink-muted"}`}>
          <Mail className="h-4 w-4" /> Email
        </button>
      </div>

      {door === "badge" ? (
      <form onSubmit={submitBadge} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="su-ref" className={authLabel}>Employee ID</label>
          <input id="su-ref" value={employeeRef} onChange={(e) => setEmployeeRef(e.target.value)} autoComplete="username"
            placeholder="E045" autoCapitalize="characters" spellCheck={false} className={`${authField} font-mono uppercase`} />
          <p className="text-xs text-auth-ink-muted">The number on your badge. Your name and shift are already in the system.</p>
          {/*
            The way out of a box you cannot fill.

            Fifty-one people on the roster have no `employee_ref` at all, so for them
            this field has no right answer and never will until somebody adds one —
            and plenty of the rest have simply never read the number off their badge.
            The screen used to say "the number on your badge" and stop there, which
            left them with a form, no answer, and nothing to click. Standing still is
            what people do at that point.

            It is a disclosure rather than a paragraph because the people who know
            their number should not have to read past it, and the ones who do not
            should find it exactly where they get stuck.
          */}
          <details className="group rounded-md border border-auth-line bg-auth-field/40">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-auth-ink marker:content-none">
              Don't know your ID?
            </summary>
            <div className="space-y-2 border-t border-auth-line px-3 py-2.5 text-xs text-auth-ink-muted">
              <p>
                It's printed on your badge: one to three letters and then the digits, like E045.
              </p>
              <p>
                No number on your badge, or it isn't working? Your supervisor or the office can look
                it up — they have the list. If you have a work email, you can register with that
                instead and skip the number.
              </p>
              <button type="button" onClick={() => { setDoor("email"); setError(""); }} className={authLink}>
                Register with my email
              </button>
            </div>
          </details>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="su-pass-b" className={authLabel}>Choose a password</label>
          <div className="relative">
            <input id="su-pass-b" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
              className={authFieldAction} />
            <button type="button" onClick={() => setShowPassword((s) => !s)} className={authInlineBtn} aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="su-code-b" className={authLabel}>Invite code</label>
          <input id="su-code-b" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off"
            placeholder="From your supervisor" className={authField} />
          {/* Arriving by the link or the printed QR fills this in. Saying so stops the
              reader checking a field that is already right, and says where the code
              came from for the ones who have to go and find it. */}
          <p className="text-xs text-auth-ink-muted">
            {fromLink
              ? "Filled in from the link you opened."
              : "From the sign-up sheet where you clock in, or your supervisor."}
          </p>
        </div>

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-strong">{error}</p>}

        <button type="submit" disabled={submitting} className={authPrimaryBtn}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Create account and sign in
        </button>

        <p className="text-center text-sm text-auth-ink-muted">
          Already have an account? <Link to="/login" className={authLink}>Sign in</Link> with your ID.
        </p>
      </form>
      ) : (
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="su-name" className={authLabel}>Full name</label>
          <input id="su-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
            className={authField} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="su-email" className={authLabel}>Email</label>
          <input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            className={authField} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="su-pass" className={authLabel}>Password</label>
          <div className="relative">
            <input id="su-pass" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password"
              className={authFieldAction} />
            <button type="button" onClick={() => setShowPassword((s) => !s)} className={authInlineBtn} aria-label={showPassword ? "Hide password" : "Show password"}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="su-code" className={authLabel}>Invite code</label>
          <input id="su-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off"
            placeholder="Ask your administrator"
            className={authField} />
        </div>

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-strong">{error}</p>}

        <button type="submit" disabled={submitting}
          className={authPrimaryBtn}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Create account
        </button>

        <p className="text-center text-sm text-auth-ink-muted">
          Already have an account? <Link to="/login" className={authLink}>Sign in</Link>
        </p>
      </form>
      )}
    </AuthShell>
  );
}
