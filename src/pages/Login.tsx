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
import { setFavicon, resetFavicon } from "@/lib/favicon";
import { dashboardPathFor, type Role } from "@/lib/permissions";
import { SignupQrCard } from "@/components/SignupQrCard";
import { isFunctionUnreachable } from "@/lib/edgeFunctionUnreachable";
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
// Quanto tempo o campo de identificação tem de estar parado antes de a marca do
// posto passar para o separador. O ícone é uma etiqueta, não um indicador de
// digitação: só muda depois de quem escreve ter acabado.
const FAVICON_SETTLE_MS = 400;

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
  // Why the sign-in failed, kept on screen until the next attempt.
  //
  // Every failure path used to end in a toast and nothing else. A toast is gone in
  // seconds, and a tablet bolted to a line is not being watched at the moment it
  // appears — the operator comes back to a form that says nothing, with the password
  // still typed in. `AdminPinGate` already does this the right way; this is the same
  // box. The toast stays too, for whoever IS looking.
  const [formError, setFormError] = useState<string | null>(null);
  // Which row the keyboard is on. The field declares role="combobox" with
  // aria-autocomplete="list", so the arrow keys have to work — they did not.
  const [activeIndex, setActiveIndex] = useState(-1);
  const comboRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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

  // O convite para criar conta não pertence ao ecrã de um posto de chão de fábrica.
  // A condição era só `!matchedTablet`, por isso o link ficava visível enquanto o
  // operador escolhia da lista — que é exactamente quando ele está a olhar. Some
  // assim que há postos e o que está escrito ainda não é um endereço.
  const showCreateAccount = !matchedTablet && !(hasTablets && !isEmail);

  // ── Rate limit state ────────────────────────────────────────
  // Identity used as the rate-limit key (tablet account id or email).
  const matchedEmployee = identity.kind === "employee" ? identity.employee_ref : null;
  const rlId = matchedTablet ? matchedTablet.id
    : identity.kind === "email" ? identity.email
    : matchedEmployee ? `emp:${matchedEmployee}` : "";
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
    setIdentifier((prev) => {
      if (prev !== "") return prev;
      // O posto já está escrito, portanto o que falta é a password — e o foco ia
      // para lado nenhum, obrigando a um toque no campo antes de escrever. Doze
      // vezes por turno, de luva.
      requestAnimationFrame(() => passwordRef.current?.focus());
      return acc.label;
    });
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
  //
  // `matchedTablet` resolve-se a cada tecla escrita no campo de identificação, e
  // ligar isto directamente ao efeito fazia o ícone do separador saltar entre a
  // marca do posto e a marca de staff letra a letra. Um ícone que pisca a cada
  // tecla não identifica coisa nenhuma — só se espera que o campo assente. Quem
  // repõe o ícone por omissão é o módulo, a partir do que o markup declarou, e
  // não deste efeito a guardar o href que lá estava (que a meio da escrita já
  // era o de outra marca).
  const brandingKey = matchedTablet ? "tablet" : "staff";
  const brandedFavicon = matchedTablet?.favicon_url || branding?.[brandingKey]?.url || null;
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (brandedFavicon) setFavicon(brandedFavicon);
      else resetFavicon();
    }, FAVICON_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [brandedFavicon]);

  // Ao sair do login o separador volta à marca do sistema.
  useEffect(() => resetFavicon, []);

  const pickTablet = (acc: PublicTabletAccount) => {
    setIdentifier(acc.label);
    setListOpen(false);
    setActiveIndex(-1);
    setFormError(null);
    // Escolher o posto é meia decisão; a outra metade é a password, e o teclado do
    // tablet já está aberto. Levar o foco lá poupa um toque.
    requestAnimationFrame(() => passwordRef.current?.focus());
  };

  /** Setas, Enter e Escape na lista de postos — o campo anuncia-se como combobox. */
  const onIdentifierKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setListOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!hasTablets || suggestions.length === 0) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!listOpen) {
        setListOpen(true);
        setActiveIndex(e.key === "ArrowDown" ? 0 : suggestions.length - 1);
        return;
      }
      setActiveIndex((i) => {
        const next = e.key === "ArrowDown"
          ? (i + 1) % suggestions.length
          : (i <= 0 ? suggestions.length - 1 : i - 1);
        listRef.current?.querySelectorAll("li")[next]?.scrollIntoView({ block: "nearest" });
        return next;
      });
      return;
    }
    if (e.key === "Enter" && listOpen && activeIndex >= 0) {
      // Só intercepta o Enter quando há mesmo uma linha escolhida com as setas;
      // caso contrário o Enter continua a submeter o formulário, como sempre.
      e.preventDefault();
      pickTablet(suggestions[activeIndex]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!identifier.trim()) {
      const msg = "Enter your email or employee ID, or pick your tablet.";
      setFormError(msg);
      toast({ title: msg, variant: "destructive" });
      return;
    }
    // Nem email nem tablet: dizer isso agora é melhor do que deixar o Supabase
    // devolver "Unable to validate email address: invalid format".
    if (unrecognised) {
      const msg = hasTablets
        ? "Not recognised. Use your work email, your employee ID (like E045), or pick your tablet from the list."
        : "Not recognised. Use your work email address or your employee ID (like E045).";
      setFormError(msg);
      toast({ title: "Not recognised", description: msg, variant: "destructive" });
      return;
    }

    // Block while locked out.
    const pre = getLoginLockout(rlId);
    if (pre.lockedMsLeft > 0) {
      const msg = `Too many attempts. Try again in ${Math.ceil(pre.lockedMsLeft / 1000)}s.`;
      setFormError(msg);
      toast({ title: "Too many attempts", description: msg, variant: "destructive" });
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
      } else if (matchedEmployee) {
        // A badge number. The function keys the account to the roster and never
        // hands the synthetic email to the browser — tokens only, like the tablets.
        const { data, error } = await invokeFunction<{ access_token: string; refresh_token: string }>(
          "employee-signin", { mode: "signin", employee_ref: matchedEmployee, password },
        );
        // The same door, the same silence. When `employee-signin` cannot be reached
        // the browser's preflight fails and nothing comes back, so "Failed to send a
        // request to the Edge Function" is all the SDK has. Signing in with an email
        // address does not go through this function and still works.
        if (isFunctionUnreachable(error)) {
          throw new Error("Signing in with a badge number isn't working right now. Use your email address, or ask your supervisor.");
        }
        if (error) throw error;
        if (!data?.access_token || !data?.refresh_token) throw new Error("Invalid credentials");
        const { error: setErr } = await supabase.auth.setSession({
          access_token: data.access_token, refresh_token: data.refresh_token,
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

      // "Wrong password" and "I could not reach the server" used to read exactly the
      // same, so an operator on a dropped uplink retyped a password that was never
      // the problem — five times, and then the lockout. They are different problems
      // with different answers, so they now say different things.
      const lower = reason.toLowerCase();
      const isNetwork = lower.includes("failed to fetch")
        || lower.includes("networkerror")
        || lower.includes("load failed")
        || lower.includes("timeout")
        || lower.includes("aborted");
      const isCredentials = lower.includes("invalid credentials")
        || lower.includes("invalid login")
        || lower.includes("invalid_grant");

      const description = after.lockedMsLeft > 0
        ? `Too many attempts — locked for ${Math.ceil(after.lockedMsLeft / 1000)}s.`
        : isNetwork
          ? "No connection to the server. Your password is fine — check the wifi and try again."
          : isCredentials
            ? `That password is not right for ${matchedTablet ? `"${matchedTablet.label}"` : "this account"}.${after.remaining > 0 ? ` ${after.remaining} attempt${after.remaining === 1 ? "" : "s"} left before it locks.` : ""}`
            : `${reason}${after.remaining > 0 ? ` · ${after.remaining} attempt${after.remaining === 1 ? "" : "s"} remaining` : ""}`;

      setFormError(description);
      toast({ title: "Sign-in failed", description, variant: "destructive" });
      setAuthed(false);
      // A password errada é para reescrever; o posto não. Deixar o foco onde o erro
      // é, em vez de obrigar a procurá-lo.
      if (!isNetwork) requestAnimationFrame(() => passwordRef.current?.focus());
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
                setFormError(null);
                setActiveIndex(-1);
                // Só abre enquanto houver escolha por fazer. Abrir sempre punha um
                // painel de doze linhas por cima do campo da password e do botão de
                // entrar — a lista tapava precisamente o que vinha a seguir.
                if (hasTablets) setListOpen(true);
              }}
              onFocus={() => { if (hasTablets && !identifier) setListOpen(true); }}
              onKeyDown={onIdentifierKeyDown}
              placeholder={hasTablets ? "you@appliednutrition.com, E045, or Line 3" : "you@appliednutrition.com or E045"}
              required
              autoComplete="username"
              spellCheck={false}
              role="combobox"
              aria-expanded={listOpen}
              aria-controls="tablet-list"
              aria-autocomplete="list"
              aria-activedescendant={
                listOpen && activeIndex >= 0 ? `tablet-option-${suggestions[activeIndex]?.id}` : undefined
              }
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
                ref={listRef}
                role="listbox"
                aria-label="Tablets"
                className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-auth-line bg-auth-paper py-1 shadow-lg"
              >
                {accountsLoading && (
                  <li className="px-4 py-2.5 text-sm text-auth-ink-muted">Loading tablets…</li>
                )}
                {suggestions.map((acc, i) => {
                  const active = matchedTablet?.id === acc.id;
                  const onKey = i === activeIndex;
                  // A linha a que o posto escreve, dita antes de alguém entrar nele.
                  // O rótulo é texto livre: "Capsules Line" aponta para a Tablet Line,
                  // e sem isto não havia como sabê-lo de pé ao lado do tablet.
                  const lineText = acc.line_names?.length
                    ? acc.line_names.join(" · ")
                    : "No line assigned";
                  return (
                    <li key={acc.id} id={`tablet-option-${acc.id}`} role="option" aria-selected={active}>
                      <button
                        type="button"
                        onClick={() => pickTablet(acc)}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={`flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          active || onKey ? "bg-auth-brand/[0.06]" : "hover:bg-auth-ink/[0.04]"
                        }`}
                      >
                        <Tablet className="h-4 w-4 shrink-0 text-auth-ink-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-auth-ink">
                            {acc.label}
                          </span>
                          <span
                            className={`block truncate text-2xs ${
                              acc.line_names?.length ? "text-auth-ink-muted" : "text-warning-strong"
                            }`}
                          >
                            {lineText}
                          </span>
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
                {/* Diz a LINHA, não só que é um tablet. É a última oportunidade de
                    alguém reparar que está prestes a escrever produção no sítio
                    errado — e a única, porque depois de entrar o ecrã já assume. */}
                {matchedTablet.line_names?.length
                  ? `${matchedTablet.line_names.join(" · ")} · Operator access`
                  : "Shared tablet · No line assigned"}
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
              ref={passwordRef}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setFormError(null); }}
              placeholder="••••••••"
              minLength={6}
              required
              autoComplete="current-password"
              aria-invalid={formError ? true : undefined}
              aria-describedby={formError ? "login-error" : undefined}
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

        {/* O que correu mal, dito onde ficou o problema — e que lá fica até à
            tentativa seguinte. Um toast já tinha desaparecido quando o operador
            voltou a olhar para o tablet. */}
        {formError && (
          <p
            id="login-error"
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-sm font-medium text-destructive-strong"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </p>
        )}

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

      {/* On a shared tablet there is no "create account": the login would be bound to
          one person for good, and the next twenty people would answer overtime as
          them. The code sends them to their own phone instead. */}
      {!showCreateAccount && (matchedTablet || hasTablets) && <SignupQrCard />}

      {showCreateAccount && (
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
