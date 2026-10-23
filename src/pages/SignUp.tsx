import { useEffect, useRef, useState } from "react";
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
import { Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { invokeFunction } from "@/lib/invokeFunction";
import { looksLikeEmployeeRef } from "@/lib/loginIdentity";
import { isSharedTabletSession } from "@/lib/sharedTabletSession";
import { signupErrorMessage, withConnectionRetry } from "@/lib/signupConnection";
import { roleTitle, type Role } from "@/lib/permissions";
import { readInviteCode, forgetInviteCode, INVALID_INVITE_MESSAGE } from "@/lib/signupInviteCode";
import { createClient } from "@supabase/supabase-js";

/**
 * A client that never touches this browser's stored session.
 *
 * `auth.signUp` signs the new account in when confirmation is off, and that replaces
 * whatever session the browser holds. On a line tablet that is the tablet's own login:
 * the whole line would then be signed in as the person who just registered. Signing up
 * through a client with no persistence leaves the tablet exactly as it was.
 */
const detachedAuthClient = () =>
  createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "an-signup-detached" },
  });

/**
 * Who the account will be, said before it is created. The person does not choose it:
 * the badge always makes an Employee, and the email door makes whatever the admin set
 * in Sign-up settings. A role picker here would hand the choice to anyone holding the
 * code, admin included.
 */
function JoinsAs({ role }: { role: string | null }) {
  if (!role || !(role in roleTitle)) return null;
  return (
    <p className="text-sm text-auth-ink-muted">
      You'll join as <b className="text-auth-ink">{roleTitle[role as Role]}</b>
      {role === "employee" ? " — you'll see overtime on offer and answer it." : "."}
    </p>
  );
}

/** What the invite field says under itself: where the code came from, and whether it is still good. */
function InviteHint({ fromLink, check }: { fromLink: boolean; check: "checking" | "ok" | "bad" | null }) {
  if (fromLink && check === "bad") {
    return <p role="alert" className="text-xs font-medium text-auth-danger">{INVALID_INVITE_MESSAGE}</p>;
  }
  return (
    <p className="text-xs text-auth-ink-muted">
      {!fromLink
        ? "From the sign-up sheet where you clock in, or your supervisor."
        : check === "checking"
        ? "Filled in from the link you opened — checking it…"
        : check === "ok"
        ? "Filled in from the link you opened. It's valid — you can carry on."
        : "Filled in from the link you opened."}
    </p>
  );
}

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
  // Read once: from the address, or from this tab if the address lost it on the way.
  const [arrived] = useState(() => readInviteCode(window.location.search));
  const [code, setCode] = useState(arrived.code);
  /** Whether the code came with the link, which decides what the field says about it. */
  const fromLink = arrived.fromLink && code === arrived.code;
  /**
   * A code that came with the link is checked as soon as the page opens, so somebody
   * holding last month's sheet finds out before typing a password, not after. Only
   * `false` is a refusal: a dropped connection says nothing about the code, and the
   * submit asks the server again either way.
   */
  const [linkCheck, setLinkCheck] = useState<"checking" | "ok" | "bad" | null>(arrived.fromLink ? "checking" : null);
  useEffect(() => {
    if (!arrived.fromLink) return;
    let alive = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
    Promise.resolve((supabase.rpc as any)("check_invite_code", { code: arrived.code }))
      .then(({ data, error }: { data: boolean | null; error: unknown }) => {
        if (alive) setLinkCheck(!error && data === true ? "ok" : !error && data === false ? "bad" : null);
      })
      .catch(() => { if (alive) setLinkCheck(null); });
    return () => { alive = false; };
  }, [arrived]);
  /**
   * Opened on a shared tablet: from the tablet's own button (`?tablet=1`) or with the
   * tablet signed in. Then the account is created and nobody is signed in as it here.
   */
  const [onTablet] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get("tablet") === "1") return true;
    } catch { /* fall through */ }
    return isSharedTabletSession();
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);


  /**
   * One request per tap. `disabled={submitting}` only lands on the next render, and a
   * double tap on a phone gets there first — two sign-ups for one person, the second
   * answered "already registered" over the top of the first one's success.
   */
  const inFlight = useRef(false);
  const once = (fn: (e: React.FormEvent) => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    try { await fn(e); } finally { inFlight.current = false; }
  };

  const submit = once(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Enter your name."); return; }
    if (!email.trim()) { setError("Enter your email."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (!code.trim()) { setError("Enter the invite code."); return; }

    setSubmitting(true);
    try {
      // 1) Validate the invite code server-side (without exposing it).
      const { data: ok, error: rpcErr } = await withConnectionRetry<{ data: boolean | null; error: unknown }>(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
        () => (supabase.rpc as any)("check_invite_code", { code: code.trim() }),
      );
      if (rpcErr) throw rpcErr;
      if (!ok) { setError(INVALID_INVITE_MESSAGE); setSubmitting(false); return; }

      // 2) Create the account. Lands PENDING (active=false, no role) via the DB trigger.
      const auth = onTablet ? detachedAuthClient().auth : supabase.auth;
      // Repeating a sign-up whose first attempt did arrive is harmless: with confirmation
      // on, the server answers an already-registered address exactly as it answers a new
      // one, and sends nothing twice.
      const { error: signErr } = await withConnectionRetry(() => auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { name: name.trim(), self_signup: "true" },
          // An overtime account is for one thing; land it there after the email click.
          emailRedirectTo: autoRole
            ? `${window.location.origin}/login?next=${encodeURIComponent("/dashboard/my-overtime")}`
            : `${window.location.origin}/login`,
        },
      }));
      if (signErr) throw signErr;
      forgetInviteCode();
      // Don't leave a half-session around — the account still needs approval. On a
      // tablet there is none to clear, and signing out would sign the tablet out.
      if (!onTablet) await supabase.auth.signOut();
      setDone(true);
    } catch (err) {
      setError(signupErrorMessage(err, "Could not create the account."));
    } finally {
      setSubmitting(false);
    }
  });

  if (done) {
    return (
      <AuthShell title="Account created" subtitle="One more step">
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-auth-success" />
          <p className="text-sm text-auth-ink">
            {onTablet
              ? <>Your account is ready. Sign in on your own phone with your email and the password you just chose — this tablet stays signed in as the line.</>
              : autoRole
              ? <>Check your email and tap the confirmation link. Then sign in, pick your name once, and you're set — you'll be told whenever overtime opens.</>
              : <>Check your email to confirm your address, then wait for an administrator to approve your account and assign your role. You'll be able to sign in once approved.</>}
          </p>
          <button
            type="button"
            onClick={() => navigate(onTablet && isSharedTabletSession() ? "/dashboard/my-overtime" : "/login")}
            className={authPrimaryBtn}
          >
            {onTablet && isSharedTabletSession() ? "Back to the tablet" : "Back to sign in"}
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create account" subtitle="Register with your email">
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
            placeholder="From the sign-up sheet, or your supervisor"
            className={authField} />
          {/* The same sentence as the badge door. This door was left without one, so
              somebody who switched tabs to escape a number they did not know arrived
              at a second box with even less to go on — "Ask your administrator", in a
              factory where the administrator is not who you ask. */}
          <InviteHint fromLink={fromLink} check={linkCheck} />
        </div>

        <JoinsAs role={autoRole} />
        {error && <p className="rounded-md bg-auth-danger/10 px-3 py-2 text-sm text-auth-danger">{error}</p>}

        <button type="submit" disabled={submitting}
          className={authPrimaryBtn}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Create account
        </button>

        <p className="text-center text-sm text-auth-ink-muted">
          Already have an account? <Link to="/login" className={authLink}>Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
