import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowLeft, CheckCircle2, KeyRound, AlertCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  authFieldIconed,
  authFieldIconedAction,
  authGhostBtn as ghostBtn,
  authIcon,
  authInlineBtn,
  authLabel,
  authPrimaryBtn as primaryBtn,
} from "@/components/auth/authStyles";
import {
  BADGE_RESET_MESSAGE,
  friendlySendLinkError,
  friendlyUpdatePasswordError,
  isBadgeEmail,
  isRecoverySessionMissing,
  recoveryLinkHasError,
} from "@/lib/authErrors";

/**
 * Same floor as the sign-in form (`Login` refuses fewer than 6) and Supabase's
 * default minimum. Raising it here alone would let a password be set that the
 * policy elsewhere does not ask for; change it in both places, and in Supabase, together.
 */
const MIN_PASSWORD_LENGTH = 6;

/** "E045" and the like: an employee badge number, not an address. */
const looksLikeBadgeId = (value: string) => /^[a-z]{0,3}\d{1,6}$/i.test(value.trim());

function ErrorLine({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-auth-danger/30 bg-auth-danger/[0.06] px-3 py-2.5 text-sm font-medium text-auth-danger"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  // The sign-in form hands over what was already typed (router state, never the address bar).
  const handedOver = ((location.state as { identifier?: string } | null)?.identifier ?? "").trim();
  const handedOverIsBadge = handedOver !== "" && (looksLikeBadgeId(handedOver) || isBadgeEmail(handedOver));

  const [email, setEmail] = useState(handedOver.includes("@") && !handedOverIsBadge ? handedOver : "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [ready, setReady] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [formError, setFormError] = useState<string | null>(handedOverIsBadge ? BADGE_RESET_MESSAGE : null);

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    // An expired, used or tampered link comes back with the reason in the address.
    if (recoveryLinkHasError(window.location.search, hash)) {
      setLinkInvalid(true);
    } else if (params.get("type") === "recovery") {
      setRecoveryMode(true);
    }
    // The client runs PKCE, so the link in the email lands here as `?code=…`, not with
    // `#type=recovery`. supabase-js trades the code for a session and says so with
    // PASSWORD_RECOVERY — or, when it finished before this page subscribed, only with
    // the session itself. Reading the hash alone sent everyone back to "send me a link".
    // If the trade fails (code expired or already used) the first event is
    // INITIAL_SESSION with no session: that is a dead link, not a request for a new one.
    const arrivedWithCode = new URLSearchParams(window.location.search).has("code");
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (arrivedWithCode && session)) {
        setLinkInvalid(false);
        setRecoveryMode(true);
      } else if (arrivedWithCode && event === "INITIAL_SESSION" && !session) {
        setLinkInvalid(true);
      }
    });
    setReady(true);
    return () => data.subscription.unsubscribe();
  }, []);

  const requestNewLink = () => {
    setLinkInvalid(false);
    setRecoveryMode(false);
    setFormError(null);
    setPassword("");
    setConfirm("");
    navigate("/reset-password", { replace: true });
  };

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) {
      setFormError("Enter your work email address.");
      return;
    }
    // Badge accounts have no mailbox. Saying "sent" here was a promise nobody could keep.
    if (isBadgeEmail(value) || looksLikeBadgeId(value)) {
      setFormError(BADGE_RESET_MESSAGE);
      return;
    }
    if (!value.includes("@")) {
      setFormError("Enter your work email address.");
      return;
    }
    setFormError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(value, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      // Same screen whether or not the address has an account: nothing here says which.
      setSent(true);
    } catch (error: unknown) {
      setFormError(friendlySendLinkError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setFormError("The two passwords don't match.");
      return;
    }
    setFormError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: "Password updated", description: "You can now sign in with your new password." });
      setTimeout(() => navigate("/login", { replace: true }), 1500);
    } catch (error: unknown) {
      if (isRecoverySessionMissing(error)) {
        setRecoveryMode(false);
        setLinkInvalid(true);
      } else {
        setFormError(friendlyUpdatePasswordError(error));
      }
    } finally {
      setLoading(false);
    }
  };

  const backToSignIn = (
    <button
      type="button"
      onClick={() => navigate("/login", { replace: true })}
      className="flex min-h-11 w-full items-center justify-center gap-2 text-xs text-auth-ink-muted transition-colors hover:text-auth-ink"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
    </button>
  );

  if (!ready) {
    return (
      <AuthShell title="Reset password" subtitle="Verifying your recovery link…">
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-auth-ink-muted" />
        </div>
      </AuthShell>
    );
  }

  if (linkInvalid) {
    return (
      <AuthShell title="Link no longer valid" subtitle="Reset links work once and expire after a while.">
        <div className="space-y-4">
          <ErrorLine id="reset-link-error">
            This reset link has expired or was already used. Request a new one.
          </ErrorLine>
          <button type="button" onClick={requestNewLink} className={primaryBtn}>
            <Mail className="h-4 w-4" /> Send a new link
          </button>
          {backToSignIn}
        </div>
      </AuthShell>
    );
  }

  const recoveryBadge = (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-auth-success/10 px-2 py-1 text-2xs font-medium uppercase tracking-wider text-auth-success ring-1 ring-auth-success sm:gap-1.5">
      <KeyRound className="h-3 w-3" /> Recovery
    </span>
  );

  if (recoveryMode) {
    return (
      <AuthShell badge={recoveryBadge} title="Set new password" subtitle="Create a new password for your account.">
        <form onSubmit={handleUpdatePassword} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-password" className={authLabel}>New password</label>
            <div className="relative">
              <Lock className={authIcon} />
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFormError(null); }}
                placeholder="••••••••"
                minLength={MIN_PASSWORD_LENGTH}
                required
                autoComplete="new-password"
                autoFocus
                aria-invalid={formError ? true : undefined}
                aria-describedby={formError ? "reset-error" : "new-password-hint"}
                className={authFieldIconedAction}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className={authInlineBtn}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p id="new-password-hint" className="pl-1 text-2xs text-auth-ink-muted">
              Minimum {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="repeat-password" className={authLabel}>Repeat password</label>
            <div className="relative">
              <Lock className={authIcon} />
              <input
                id="repeat-password"
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setFormError(null); }}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                aria-invalid={formError ? true : undefined}
                className={authFieldIconed}
              />
            </div>
          </div>

          {formError && <ErrorLine id="reset-error">{formError}</ErrorLine>}

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
          <div className="rounded-lg border border-auth-success/30 bg-auth-success/10 p-4 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-auth-success" />
            <h3 className="mt-2 text-sm font-medium text-auth-ink">Check your inbox</h3>
            <p className="mt-1 text-xs text-auth-ink">
              If that address has an account, a password reset link is on its way. If it doesn't
              arrive, check your spam folder. Still nothing after a few minutes? Ask an
              administrator to set a new password for you in Manage Users — that works without any email.
            </p>
          </div>
          <button type="button" onClick={() => navigate("/login", { replace: true })} className={ghostBtn}>
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={handleSendLink} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className={authLabel}>Email</label>
            <div className="relative">
              <Mail className={authIcon} />
              <input
                id="reset-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setFormError(null); }}
                placeholder="name@appliednutrition.uk"
                required
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                aria-invalid={formError ? true : undefined}
                aria-describedby={formError ? "reset-error" : undefined}
                className={authFieldIconed}
              />
            </div>
          </div>

          {formError && <ErrorLine id="reset-error">{formError}</ErrorLine>}

          <button type="submit" disabled={loading} className={primaryBtn}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><Mail className="h-4 w-4" /> Send recovery link</>}
          </button>

          {backToSignIn}
        </form>
      )}
    </AuthShell>
  );
}
