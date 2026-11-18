import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A request that went out before the token was there is not a denied request.
 *
 * 17/11/2026, ProductionOffice: "permission denied for table headcount_area_hidden" at
 * 16:11 and "permission denied for table profiles" at 16:26, both 401 / 42501, filed as
 * RLS_ERROR. `authenticated` holds SELECT on both. The requests carried the anon key as
 * their bearer — supabase-js had no session at that instant — so PostgREST ran them as
 * `anon`, which holds nothing.
 *
 * Same race as the expired token (anExpiredTokenIsNotADeniedRequest), one step earlier:
 * if the session is there a moment later, the request goes again with it and nothing is
 * filed. If it is not, the 401 stands and is filed as NO_SESSION, not as a policy to fix.
 */

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const ANON = `${b64url({ alg: "HS256" })}.${b64url({ role: "anon" })}.sig`;
const USER = `${b64url({ alg: "HS256" })}.${b64url({ role: "authenticated", sub: "u-1" })}.sig`;

const getSession = vi.fn();
const refreshSession = vi.fn();
const insert = vi.fn<(r: unknown) => Promise<Record<string, unknown>>>(() => Promise.resolve({}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: () => getSession(), refreshSession: () => refreshSession() },
    from: () => ({ insert: (r: unknown) => insert(r) }),
  },
}));

const REST = "https://x.supabase.co/rest/v1/profiles?select=id,name";
const asAnon = { headers: new Headers({ apikey: ANON, Authorization: `Bearer ${ANON}` }) };
const asUser = { headers: new Headers({ apikey: ANON, Authorization: `Bearer ${USER}` }) };

function anonDenied(table = "profiles") {
  return new Response(JSON.stringify({ code: "42501", message: `permission denied for table ${table}` }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
const ok = () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
const session = (token = "live-token") => ({
  data: { session: { access_token: token, expires_at: Math.floor(Date.now() / 1000) + 3600 } },
});

let underlying: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  underlying = vi.fn();
  window.fetch = underlying as unknown as typeof fetch;
  const w = window as unknown as Record<string, unknown>;
  delete w.__staleJwtRetryInstalled;
  delete w.__apiErrorTelemetryInstalled;
  const { installStaleJwtRetry } = await import("@/lib/staleJwtRetry");
  const { installApiErrorTelemetry } = await import("@/lib/apiErrorTelemetry");
  installStaleJwtRetry();
  installApiErrorTelemetry();
});

describe("a request sent as anon while the session was a moment away", () => {
  it("goes again with the session's token, and nothing is filed", async () => {
    getSession.mockResolvedValue(session());
    underlying.mockResolvedValueOnce(anonDenied()).mockResolvedValueOnce(ok());

    const res = await window.fetch(REST, asAnon);

    expect(res.status).toBe(200);
    expect(underlying).toHaveBeenCalledTimes(2);
    expect(new Headers((underlying.mock.calls[1][1] as RequestInit).headers).get("Authorization")).toBe("Bearer live-token");
    expect(insert).not.toHaveBeenCalled();
  });

  it("is filed as NO_SESSION, not RLS_ERROR, when the browser still has no session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    underlying.mockResolvedValueOnce(anonDenied("headcount_area_hidden"));

    const res = await window.fetch("https://x.supabase.co/rest/v1/headcount_area_hidden?select=*", asAnon);

    expect(res.status).toBe(401);
    expect(underlying).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ error_type: "NO_SESSION" });
  });

  it("does not retry with a session that is already expired", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "old", expires_at: 1 } } });
    underlying.mockResolvedValueOnce(anonDenied());

    await window.fetch(REST, asAnon);

    expect(underlying).toHaveBeenCalledTimes(1);
  });
});

describe("what stays a real refusal", () => {
  it("a signed-in user's 42501 is still RLS_ERROR, and is not retried", async () => {
    underlying.mockResolvedValueOnce(anonDenied());

    const res = await window.fetch(REST, asUser);

    expect(res.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
    expect(underlying).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ error_type: "RLS_ERROR" });
  });

  it("a 403 to an anon request is not touched by the retry", async () => {
    underlying.mockResolvedValueOnce(new Response(JSON.stringify({ code: "42501", message: "x" }), { status: 403 }));

    await window.fetch(REST, asAnon);

    expect(getSession).not.toHaveBeenCalled();
    expect(underlying).toHaveBeenCalledTimes(1);
  });
});
