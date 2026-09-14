import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * "JWT expired" is not a permission denial, and the screen should not have seen it.
 *
 * 14/09 05:58, /dashboard/shift-history, a GET on `lines`: PostgREST answered 401
 * with `PGRST303`, the fetch wrapper read the 401 and filed it as an RLS_ERROR, and
 * the person looking at the board got a screen that would not load. Nothing was
 * denied to anybody — a tablet left on overnight woke up and asked before
 * supabase-js had finished swapping its token, which is a race the client can win
 * on its own.
 *
 * PostgREST validates the JWT before it touches the database, so a PGRST303 request
 * had no effect of any kind: re-issuing it is safe whatever the method was, and the
 * retry is not restricted to reads.
 */

const refreshSession = vi.fn(async () => ({
  data: { session: { access_token: "fresh-token" } },
  error: null,
}));

const insert = vi.fn<(r: unknown) => Promise<Record<string, unknown>>>(() => Promise.resolve({}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { refreshSession: () => refreshSession() },
    from: () => ({ insert: (r: unknown) => insert(r) }),
  },
}));

const REST = "https://x.supabase.co/rest/v1/lines?select=*";

function expired() {
  return new Response(JSON.stringify({ code: "PGRST303", message: "JWT expired" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
function denied() {
  return new Response(JSON.stringify({ code: "42501", message: "permission denied" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
function ok(body = "[]") {
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

let underlying: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  refreshSession.mockClear();
  underlying = vi.fn();
  window.fetch = underlying as unknown as typeof fetch;
  delete (window as unknown as Record<string, unknown>).__staleJwtRetryInstalled;
  const { installStaleJwtRetry } = await import("@/lib/staleJwtRetry");
  installStaleJwtRetry();
});

describe("an expired token", () => {
  it("is refreshed and the request re-issued, so the caller never sees the 401", async () => {
    underlying.mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok('[{"id":1}]'));

    const res = await window.fetch(REST, {
      method: "GET",
      headers: { Authorization: "Bearer stale-token", apikey: "anon" },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('[{"id":1}]');
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it("re-issues with the token the refresh handed back, not the stale one", async () => {
    underlying.mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok());

    await window.fetch(REST, {
      method: "GET",
      headers: { Authorization: "Bearer stale-token", apikey: "anon" },
    });

    const retryInit = underlying.mock.calls[1][1] as RequestInit;
    expect(new Headers(retryInit.headers).get("Authorization")).toBe("Bearer fresh-token");
    // Everything else the caller sent has to survive the re-issue.
    expect(new Headers(retryInit.headers).get("apikey")).toBe("anon");
  });

  it("retries a write too, because PostgREST refused it before it did anything", async () => {
    underlying.mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok());

    const res = await window.fetch("https://x.supabase.co/rest/v1/downtime_events", {
      method: "POST",
      headers: { Authorization: "Bearer stale-token" },
      body: '{"minutes":5}',
    });

    expect(res.status).toBe(200);
    expect((underlying.mock.calls[1][1] as RequestInit).body).toBe('{"minutes":5}');
  });

  it("refreshes once for a burst, not once per request in flight", async () => {
    underlying.mockResolvedValue(ok());
    underlying.mockResolvedValueOnce(expired()).mockResolvedValueOnce(expired());

    await Promise.all([
      window.fetch(REST, { headers: { Authorization: "Bearer stale-token" } }),
      window.fetch(REST, { headers: { Authorization: "Bearer stale-token" } }),
    ]);

    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});

describe("what is not retried", () => {
  it("leaves a real denial alone, so RLS still reaches the log", async () => {
    underlying.mockResolvedValueOnce(denied());

    const res = await window.fetch(REST, { headers: { Authorization: "Bearer t" } });

    expect(res.status).toBe(401);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it("gives up after one retry, so a dead session cannot loop", async () => {
    underlying.mockResolvedValue(expired());

    const res = await window.fetch(REST, { headers: { Authorization: "Bearer t" } });

    expect(res.status).toBe(401);
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it("surfaces the 401 when the refresh itself fails — that session really is gone", async () => {
    refreshSession.mockResolvedValueOnce({ data: { session: null }, error: null } as never);
    underlying.mockResolvedValueOnce(expired());

    const res = await window.fetch(REST, { headers: { Authorization: "Bearer t" } });

    expect(res.status).toBe(401);
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it("does not touch anything that is not a data or function call", async () => {
    underlying.mockResolvedValueOnce(expired());

    const res = await window.fetch("https://x.supabase.co/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
    });

    expect(res.status).toBe(401);
    expect(refreshSession).not.toHaveBeenCalled();
  });
});

/**
 * The order the two wrappers go on is the whole fix.
 *
 * Both wrap `window.fetch`, and the one installed LAST is the outer one — the one
 * that sees the answer the caller sees. Retry inside, telemetry outside, and a
 * recovered request never reaches the log. The other way round and every one of them
 * is still filed as an RLS_ERROR, which is exactly the line this was written to stop.
 */
describe("the two fetch wrappers, in the order main.tsx puts them on", () => {
  beforeEach(async () => {
    vi.resetModules();
    insert.mockClear();
    refreshSession.mockClear();
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

  it("files nothing when the retry recovers the request", async () => {
    underlying.mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok());

    const res = await window.fetch(REST, { headers: { Authorization: "Bearer stale" } });

    expect(res.status).toBe(200);
    expect(insert).not.toHaveBeenCalled();
  });

  it("still files the 401 when the fresh token is refused too", async () => {
    underlying.mockResolvedValue(expired());

    await window.fetch(REST, { headers: { Authorization: "Bearer stale" } });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ error_type: "RLS_ERROR", message: "JWT expired" });
  });
});

describe("main.tsx", () => {
  it("installs the retry before the telemetry, or the recovery is filed anyway", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const src = readFileSync(join(process.cwd(), "src/main.tsx"), "utf8");
    const retry = src.indexOf("installStaleJwtRetry()");
    const telemetry = src.indexOf("installApiErrorTelemetry()");
    expect(retry).toBeGreaterThan(-1);
    expect(telemetry).toBeGreaterThan(-1);
    expect(retry).toBeLessThan(telemetry);
  });
});
