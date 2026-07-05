import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

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
      <main className="min-h-screen flex items-center justify-center p-6 text-white bg-[hsl(222_47%_6%)]">
        <div className="max-w-md space-y-3">
          <h1 className="text-xl font-semibold">Authorization error</h1>
          <p className="text-sm text-white/70">{error}</p>
        </div>
      </main>
    );
  }
  if (!details) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[hsl(222_47%_6%)] text-white">
        <Loader2 className="h-6 w-6 animate-spin" />
      </main>
    );
  }

  const clientName = details.client?.name ?? "an external app";
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[hsl(222_47%_6%)] text-white">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/5 p-6 space-y-5">
        <h1 className="text-xl font-semibold">Connect {clientName} to AN Maintenance</h1>
        <p className="text-sm text-white/70">
          {clientName} is requesting access to your AN Maintenance account. It will act on your behalf using your
          permissions.
        </p>
        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-md bg-[hsl(214_90%_50%)] px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            Approve
          </button>
          <button
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-md border border-white/20 px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            Deny
          </button>
        </div>
      </div>
    </main>
  );
}
