import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldAlert,
  Tablet,
} from "lucide-react";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import { useAuth } from "@/contexts/AuthContext";
import { usePublicTabletAccounts, type PublicTabletAccount } from "@/hooks/useOperatorAccounts";
import { invokeFunction } from "@/lib/invokeFunction";
import { useLoginBranding } from "@/hooks/useLoginBranding";
import { dashboardPathFor, type Role } from "@/lib/permissions";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  authBtnBase,
  authFieldIconed,
  authFieldIconedAction,
  authIcon,
  authInlineBtn,
  authLabel,
  authLink,
} from "@/components/auth/authStyles";
import {
  clearLoginLockout,
  getLoginLockout,
  recordLoginFailure,
} from "@/lib/loginRateLimit";
import { resolveIdentity, suggestTablets } from "@/lib/loginIdentity";

const TABLET_KEY = "an_tablet_account_id";
const TABLET_TS_KEY = "an_tablet_account_id_at";
// Tablet selection auto-clears after one shift (8 hours) so a tablet left
// idle overnight forces a fresh pick instead of silently re-using yesterday's.
const TABLET_SELECTION_TTL_MS = 8 * 60 * 60 * 1000;
// Persisted credentials used to silently re-login a Tablet account whose
// refresh-token was revoked (e.g. the same shared account refreshing on
// another tablet). Scoped to shared tablet accounts only — never used for staff.
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

/**
 * Sign-in.
 *
 * Havia aqui três cartões de ambiente (Desktop / Tablet / Mobile) e, dentro do
 * ambiente Tablet, mais um par de separadores (Conta partilhada / A minha conta):
 * cinco controlos para uma decisão que é binária — ou entras com o teu email, ou
 * entras com um tablet de linha partilhado. Pior, o ambiente escolhido não decidia
 * nada sobre o acesso: isso sempre veio do papel (RBAC + RLS), e o aviso de
 * incompatibilidade só aparecia *depois* de a sessão já estar aberta.
 *
 * Ficou um campo. O que lá escreves é que diz quem és: uma arroba é uma pessoa, um
 * nome de tablet é um posto. O ecrã mostra o que reconheceu antes de submeteres,
 * para o reconhecimento ser visível e não magia.
 *
 * Os dois caminhos de autenticação continuam a ser dois, porque são mesmo
 * diferentes: o staff vai a `signInWithPassword`, o tablet vai à edge function
 * `tablet-signin`, que resolve o email do lado do servidor (nunca chega ao browser)
 * e força o papel `operator`. É por isso que um engenheiro tem de entrar pelo seu
 * email mesmo quando está a usar um tablet — pela conta partilhada perderia o papel.
 */
export default function Login() {
  const navigate = useNavigate();
  // Login lands on the role's own dashboard. It used to always land on a separate
  // welcome page, which meant two landing screens to keep in step.
  const landAfterLogin = (r: string | null | undefined) => dashboardPathFor(r as Role | null);
  const [searchParams] = useSearchParams();
  // Consent flow (and other deep-links) preserve where to send the user
  // after sign-in. Only same-origin relative paths are honored.
  const nextParam = searchParams.get("next");
  const safeNext = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : null;
  const { toast } = useToast();
  const { session, role, loading: authLoading } = useAuth();
  const { data: tabletAccounts, isLoading: accountsLoading } = usePublicTabletAccounts();
  const { data: branding } = useLoginBranding();

  // ── Form state ──────────────────────────────────────────────
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const identity = useMemo(
    () => resolveIdentity<PublicTabletAccount>(identifier, tabletAccounts),
    [identifier, tabletAccounts],
  );
  const matchedTablet = identity.kind === "tablet" ? identity.tablet : null;
  const isEmail = identity.kind === "email";
  const unrecognised = identity.kind === "unknown";

  const suggestions = useMemo(
    () => suggestTablets(identifier, tabletAccounts),
    [identifier, tabletAccounts],
  );

  const hasTablets = (tabletAccounts?.length ?? 0) > 0;

  // A lista serve para escolher, por isso só aparece enquanto houver escolha. Com o
  // nome já completo e nenhum outro posto parecido não sobra nada para escolher — e
  // um painel de um item só tapava a linha que diz o que o sistema reconheceu e a
  // etiqueta do campo seguinte. Com dois "Line 3 …" na lista, continua a valer.
  const canChoose = suggestions.length > (matchedTablet ? 1 : 0);

  // ── Rate limit state ────────────────────────────────────────
  // Identity used as the rate-limit key (tablet account id or email).
  const rlId = matchedTablet ? matchedTablet.id : (identity.kind === "email" ? identity.email : "");
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

  // Um tablet de chão de fábrica é um posto fixo: quem o usou no turno encontra o
  // seu nome já escrito. A selecção guardada caduca ao fim de 8h, e some de vez se
  // a conta tiver sido entretanto apagada.
  useEffect(() => {
    if (!tabletAccounts) return;
    const stored = getStoredTabletId();
    if (!stored) return;
    const acc = tabletAccounts.find((a) => a.id === stored);
    if (!acc) {
      localStorage.removeItem(TABLET_KEY);
      localStorage.removeItem(TABLET_TS_KEY);
      return;
    }
    setIdentifier((prev) => (prev === "" ? acc.label : prev));
  }, [tabletAccounts]);

  // Redirect when authenticated
  useEffect(() => {
    if (!authLoading && session && role) {
      if (safeNext) {
        window.location.href = safeNext;
        return;
      }
      navigate(landAfterLogin(role), { replace: true });
    }
  }, [authLoading, navigate, role, session, safeNext]);

  // Fecha a lista ao clicar fora dela.
  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!comboRef.current?.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [listOpen]);

  // Reflect the active per-tablet / per-mode favicon in the browser tab too.
  // Restores the default on unmount.
  const brandingKey = matchedTablet ? "tablet" : "staff";
  useEffect(() => {
    const url = matchedTablet?.favicon_url || branding?.[brandingKey]?.url || "/favicon.png";
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
  }, [brandingKey, matchedTablet?.favicon_url, branding]);

  const pickTablet = (acc: PublicTabletAccount) => {
    setIdentifier(acc.label);
    setListOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!identifier.trim()) {
      toast({ title: "Enter your email, or pick your tablet", variant: "destructive" });
      return;
    }
    // Nem email nem tablet: dizer isso agora é melhor do que deixar o Supabase
    // devolver "Unable to validate email address: invalid format".
    if (unrecognised) {
      toast({
        title: "Not recognised",
        description: hasTablets
          ? "Use your work email, or pick your tablet from the list."
          : "Use your work email address.",
        variant: "destructive",
      });
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
      if (matchedTablet) {
        // Tablet sign-in goes through the edge function so the email is never
        // sent to the browser. The function resolves the email server-side and
        // returns only session tokens.
        const { data, error } = await invokeFunction<{
          access_token: string;
          refresh_token: string;
        }>("tablet-signin", {
          account_id: matchedTablet.id,
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
          email: identity.kind === "email" ? identity.email : identifier.trim().toLowerCase(),
          password,
        });
        if (error) throw error;
      }

      // Success — wipe the rate-limit counter for this identity.
      clearLoginLockout(rlId);
      setAuthed(true);
      toast({ title: "Signed in", description: "Redirecting to your dashboard…" });

      if (matchedTablet) {
        localStorage.setItem(TABLET_KEY, matchedTablet.id);
        localStorage.setItem(TABLET_TS_KEY, String(Date.now()));
        // Persist refresh_token (NOT the password) for silent re-login on
        // token revocation. Only ever stored for shared tablet accounts.
        try {
          const { data: { session: fresh } } = await supabase.auth.getSession();
          if (fresh?.refresh_token) {
            localStorage.setItem(
              TABLET_CRED_KEY,
              JSON.stringify({ accountId: matchedTablet.id, refresh_token: fresh.refresh_token }),
            );
          }
        } catch {
          // localStorage may be unavailable; silent re-login simply won't run.
        }
      } else {
        // Staff login should never leave tablet credentials behind.
        localStorage.removeItem(TABLET_CRED_KEY);
        localStorage.removeItem(TABLET_KEY);
        localStorage.removeItem(TABLET_TS_KEY);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: roleResult } = await supabase.rpc("get_user_role", { _user_id: user.id });
        logAuditEvent("login", "user", user.id, {
          role: roleResult || "unknown",
          mode: matchedTablet ? "tablet" : "staff",
        });
        if (safeNext) {
          window.location.href = safeNext;
          return;
        }
        navigate(landAfterLogin(roleResult as string), { replace: true });
      }
    } catch (error: unknown) {
      // Count this failure and surface remaining attempts / lockout.
      const after = recordLoginFailure(rlId);
      setLockedMsLeft(after.lockedMsLeft);
      setRemaining(after.remaining);
      const reason = error instanceof Error ? error.message : String(error);
      const description = after.lockedMsLeft > 0
        ? `Too many attempts — locked for ${Math.ceil(after.lockedMsLeft / 1000)}s.`
        : `${reason}${after.remaining > 0 ? ` · ${after.remaining} attempt${after.remaining === 1 ? "" : "s"} remaining` : ""}`;
      toast({ title: "Sign-in failed", description, variant: "destructive" });
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  };

  const brandIconUrl = matchedTablet?.favicon_url || branding?.[brandingKey]?.url || undefined;

  return (
    <AuthShell
      brandIconUrl={brandIconUrl}
      maxWidthClass="max-w-lg"
      title="Sign in"
      subtitle={
        hasTablets
          ? "Use your work email, or the name of the tablet you're standing at."
          : "Use your work email."
      }
    >
      <form
        onSubmit={handleSubmit}
        className={`space-y-4 ${loading || authed ? "pointer-events-none opacity-70" : ""}`}
        autoComplete="on"
        aria-busy={loading}
      >
        {/* ── Identidade ─────────────────────────────────────────
            Um campo só. O que se escreve é que diz o que se é. */}
        <div className="space-y-1.5">
          <label htmlFor="identifier" className={authLabel}>
            {hasTablets ? "Email or tablet" : "Email"}
          </label>
          <div className="relative" ref={comboRef}>
            {matchedTablet ? (
              <Tablet className={authIcon} />
            ) : (
              <Mail className={authIcon} />
            )}
            <input
              id="identifier"
              type="text"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                if (hasTablets) setListOpen(true);
              }}
              onFocus={() => { if (hasTablets && !identifier) setListOpen(true); }}
              onKeyDown={(e) => { if (e.key === "Escape") setListOpen(false); }}
              placeholder={hasTablets ? "you@appliednutrition.com or Line 3" : "you@appliednutrition.com"}
              required
              autoComplete="username"
              spellCheck={false}
              role="combobox"
              aria-expanded={listOpen}
              aria-controls="tablet-list"
              aria-autocomplete="list"
              className={hasTablets && canChoose ? authFieldIconedAction : authFieldIconed}
            />
            {hasTablets && canChoose && (
              <button
                type="button"
                onClick={() => setListOpen((o) => !o)}
                className={authInlineBtn}
                aria-label={listOpen ? "Hide tablet list" : "Show tablet list"}
                tabIndex={-1}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${listOpen ? "rotate-180" : ""}`} />
              </button>
            )}

            {listOpen && hasTablets && (accountsLoading || canChoose) && (
              <ul
                id="tablet-list"
                role="listbox"
                aria-label="Tablets"
                className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-auth-line bg-auth-paper py-1 shadow-lg"
              >
                {accountsLoading && (
                  <li className="px-4 py-2.5 text-sm text-auth-ink-muted">Loading tablets…</li>
                )}
                {suggestions.map((acc) => {
                  const active = matchedTablet?.id === acc.id;
                  return (
                    <li key={acc.id} role="option" aria-selected={active}>
                      <button
                        type="button"
                        onClick={() => pickTablet(acc)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          active ? "bg-auth-brand/[0.06]" : "hover:bg-auth-ink/[0.04]"
                        }`}
                      >
                        <Tablet className="h-4 w-4 shrink-0 text-auth-ink-muted" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-auth-ink">
                          {acc.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* O que o sistema reconheceu, dito antes de submeter. */}
          <p className="flex min-h-[1.25rem] items-center gap-1.5 font-figure text-2xs uppercase tracking-[0.08em]">
            {matchedTablet ? (
              <span className="flex items-center gap-1.5 text-auth-brand">
                <Tablet className="h-3 w-3" />
                Shared tablet · Operator access
              </span>
            ) : isEmail ? (
              <span className="flex items-center gap-1.5 text-auth-ink-muted">
                <Mail className="h-3 w-3" />
                Work account · Access follows your role
              </span>
            ) : unrecognised && !canChoose ? (
              // Só avisa quando não há mais nada a orientar. Com postos a aparecerem
              // na lista, é a lista a resposta — dizer "não é um tablet" por baixo de
              // oito tablets seria contradizer o que está no ecrã.
              <span className="flex items-center gap-1.5 text-warning-strong">
                <AlertCircle className="h-3 w-3" />
                {hasTablets ? "Not a tablet — finish the email address" : "Enter a full email address"}
              </span>
            ) : null}
          </p>
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className={authLabel}>
              Password
            </label>
            {!matchedTablet && (
              <button
                type="button"
                onClick={() => navigate("/reset-password")}
                className="rounded text-xs font-medium text-auth-ink-muted underline-offset-4 transition-colors hover:text-auth-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-brand/40"
              >
                Forgot password?
              </button>
            )}
          </div>
          <div className="relative">
            <Lock className={authIcon} />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              required
              autoComplete="current-password"
              className={authFieldIconedAction}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className={authInlineBtn}
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
          className={`${authBtnBase} mt-2 text-white shadow-sm ${
            authed ? "bg-success" : "bg-auth-brand hover:bg-auth-brand/90 disabled:opacity-60"
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
              Sign in <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        {/* Remaining-attempts hint */}
        {lockedMsLeft === 0 && remaining < 5 && (
          <p className="pt-1 text-center text-2xs text-warning-strong">
            {remaining} attempt{remaining === 1 ? "" : "s"} remaining before lockout
          </p>
        )}
      </form>

      {!matchedTablet && (
        <p className="mt-6 text-sm text-auth-ink-muted">
          Don't have an account?{" "}
          <button
            type="button"
            onClick={() => navigate("/signup")}
            className={authLink}
          >
            Create account
          </button>
        </p>
      )}
    </AuthShell>
  );
}
