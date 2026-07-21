import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";

// Typed local wrapper over the beta supabase.auth.oauth namespace so this file
// compiles even before the SDK types are updated.
type OAuthClient = { name?: string; client_uri?: string; logo_uri?: string };
type OAuthDetails = {
  client?: OAuthClient;
  redirect_url?: string;
  redirect_to?: string;
  scopes?: string[];
};
type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: OAuthDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: OAuthDetails | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: OAuthDetails | null; error: { message: string } | null }>;
};
const oauth = (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;

const consentBadge = (
  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-100 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-sky-700 ring-1 ring-sky-200 sm:gap-1.5">
    <ShieldCheck className="h-3 w-3" /> Consent
  </span>
);

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<OAuthDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) {
        setError(error.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <AuthShell badge={consentBadge} title="Authorization error" subtitle="We couldn't complete this request.">
        <p className="text-sm text-slate-600">{error}</p>
      </AuthShell>
    );
  }

  if (!details) {
    return (
      <AuthShell badge={consentBadge} title="Preparing authorization" subtitle="Verifying the client request…">
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </AuthShell>
    );
  }

  const clientName = details.client?.name ?? "an external app";
  return (
    <AuthShell
      brandIconUrl={details.client?.logo_uri || undefined}
      badge={consentBadge}
      title={`Connect ${clientName}`}
      subtitle={`${clientName} is requesting access to your AN Maintenance account.`}
    >
      <p className="text-sm text-slate-600">
        It will act on your behalf using your permissions. Approve only if you trust this application.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          disabled={busy}
          onClick={() => decide(true)}
          className="flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#1E3A8A] text-sm font-semibold text-white transition-colors hover:bg-[#1E40AF] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          className="flex-1 inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
        >
          Deny
        </button>
      </div>
    </AuthShell>
  );
}
