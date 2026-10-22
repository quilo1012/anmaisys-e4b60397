import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";

/**
 * A shared tablet keeps a copy of its refresh token in `an_tablet_cred`, to re-login
 * silently when the session is lost. Supabase rotates that token on every refresh, and
 * re-using a rotated token makes it revoke the whole session. The copy used to follow
 * the session only on TOKEN_REFRESHED, so a session accepted through SIGNED_IN, the boot
 * read or the keep-alive left a stale copy behind.
 */

const session = (refresh: string) =>
  ({ access_token: "a", refresh_token: refresh, expires_at: 9e9, user: { id: "u1" } }) as unknown as Session;

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

const { AuthProvider } = await import("@/contexts/AuthContext");

const CRED = "an_tablet_cred";
const storedRefresh = () => JSON.parse(localStorage.getItem(CRED) ?? "{}").refresh_token;

async function mountSignedIn(initial: string) {
  auth.getSession.mockResolvedValue({ data: { session: session(initial) }, error: null });
  render(<AuthProvider><div>app</div></AuthProvider>);
  await waitFor(() => expect(auth.listener).not.toBeNull());
}

describe("the shared-tablet credential follows the live session", () => {
  beforeEach(() => {
    auth.getSession.mockReset();
    auth.listener = null;
    localStorage.clear();
    sessionStorage.clear();
  });

  it("a session accepted on SIGNED_IN rewrites a stale tablet credential", async () => {
    localStorage.setItem(CRED, JSON.stringify({ accountId: "line-1", refresh_token: "old" }));
    await mountSignedIn("old");
    act(() => auth.listener!("SIGNED_IN", session("rotated")));
    await waitFor(() => expect(storedRefresh()).toBe("rotated"));
    expect(JSON.parse(localStorage.getItem(CRED)!).accountId).toBe("line-1");
  });

  it("the keep-alive that reads a fresher session keeps the tablet credential current", async () => {
    localStorage.setItem(CRED, JSON.stringify({ accountId: "line-1", refresh_token: "old" }));
    await mountSignedIn("old");
    auth.getSession.mockResolvedValue({ data: { session: session("rotated-by-keepalive") }, error: null });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => expect(storedRefresh()).toBe("rotated-by-keepalive"));
  });

  it("does not create a tablet credential where none exists (staff sign-in)", async () => {
    await mountSignedIn("staff-token");
    act(() => auth.listener!("SIGNED_IN", session("another")));
    await waitFor(() => expect(auth.listener).not.toBeNull());
    expect(localStorage.getItem(CRED)).toBeNull();
  });
});
