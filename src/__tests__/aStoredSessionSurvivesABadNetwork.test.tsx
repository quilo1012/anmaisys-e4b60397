import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { AuthRetryableFetchError, AuthApiError, type Session } from "@supabase/supabase-js";
import { classifyBootSession, loginPathFor, noteSessionEnded, takeSessionEndNotice } from "@/lib/sessionRestore";

/**
 * "Employees keep being asked for their password." The session was in storage the
 * whole time. Two things threw it away:
 *  - the boot read a refresh that could not reach the server as "signed out", and
 *  - signing out used supabase's default scope, `global`, which ends the account's
 *    sessions on every other device too.
 */

const session = (id = "u1") =>
  ({ access_token: "a", refresh_token: "r", expires_at: 9e9, user: { id } }) as unknown as Session;

describe("reading the stored session at boot", () => {
  it("a session that came back is signed in", () => {
    expect(classifyBootSession({ data: { session: session() }, error: null }).kind).toBe("signed-in");
  });
  it("a refresh that could not reach the server keeps the person signed in", () => {
    const error = new AuthRetryableFetchError("Failed to fetch", 0);
    expect(classifyBootSession({ data: { session: null }, error }).kind).toBe("reconnecting");
  });
  it("a read that never finished keeps the person signed in", () => {
    expect(classifyBootSession(null).kind).toBe("reconnecting");
  });
  it("a refresh the server refused ends the session", () => {
    const error = new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found");
    expect(classifyBootSession({ data: { session: null }, error }).kind).toBe("ended");
  });
  it("nothing stored is signed out", () => {
    expect(classifyBootSession({ data: { session: null }, error: null }).kind).toBe("signed-out");
  });
});

describe("coming back after signing in again", () => {
  it("the login link carries the page the person was on", () => {
    expect(loginPathFor({ pathname: "/dashboard/my-overtime", search: "?week=2" }))
      .toBe("/login?next=%2Fdashboard%2Fmy-overtime%3Fweek%3D2");
    expect(loginPathFor({ pathname: "/" })).toBe("/login");
  });
  it("the reason a session ended is said once", () => {
    noteSessionEnded("expired");
    expect(takeSessionEndNotice()).toMatch(/sign-in ended/);
    expect(takeSessionEndNotice()).toBeNull();
  });
});

// ── AuthProvider against a mocked client ──────────────────────────────────────
type Listener = (event: string, s: Session | null) => void;
const auth = vi.hoisted(() => ({
  listener: null as null | ((event: string, s: unknown) => void),
  getSession: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/integrations/supabase/client", () => {
  const single = () => Promise.resolve({ data: { id: "u1", name: "E", active: true }, error: null });
  return {
    supabase: {
      auth: {
        getSession: auth.getSession,
        refreshSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        setSession: vi.fn(),
        signOut: auth.signOut,
        onAuthStateChange: (cb: Listener) => {
          auth.listener = cb as typeof auth.listener;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
      },
      from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
      rpc: (fn: string) => Promise.resolve({ data: fn === "get_user_role" ? "employee" : false, error: null }),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: vi.fn(),
    },
  };
});

const { AuthProvider, useAuth } = await import("@/contexts/AuthContext");

function Probe() {
  const { session, role, reconnecting, loading, signOut } = useAuth();
  return (
    <div>
      <span data-testid="state">{loading ? "loading" : reconnecting ? "reconnecting" : session ? `in:${role}` : "out"}</span>
      <button onClick={() => void signOut()}>out</button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    auth.getSession.mockReset();
    auth.signOut.mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("waits instead of signing out when the refresh cannot reach the server, then restores the employee", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("reconnecting"));

    // The network comes back; supabase-js's own ticker refreshes the token.
    act(() => auth.listener!("TOKEN_REFRESHED", session()));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("in:employee"));
    expect(takeSessionEndNotice()).toBeNull();
  });

  it("a session the server refused goes to the login screen with the reason", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found"),
    });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("out"));
    expect(takeSessionEndNotice()).toMatch(/sign-in ended/);
  });

  it("signing out ends this device's session only", async () => {
    auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("in:employee"));
    act(() => screen.getByText("out").click());
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("out"));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
