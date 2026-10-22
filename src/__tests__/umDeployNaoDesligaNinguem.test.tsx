import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { classifyBootSession, takeSessionEndNotice, noteSessionEnded } from "@/lib/sessionRestore";
import { isSharedTabletSession, TABLET_CRED_KEY } from "@/lib/sharedTabletSession";
import { movedOriginNotice } from "@/lib/movedOrigin";

/**
 * Phase 3 of the tablet session report: points 1, 4 and 11, plus the one test the
 * report named as missing from all twelve — the difference between "this origin has
 * never seen you" and "your session ended".
 *
 * That distinction is the whole bug. The app moved to its own domain and the old
 * address 302s to it; `localStorage` is per origin, so a device arriving through the
 * redirect carries nothing. The guard reads that correctly as a first visit — the
 * defect was that nobody was told, and that new links kept being minted on the old
 * address. See `claude/sessao-tablets-mudanca-de-origem-2026-10-22.md`.
 */

const session = (id = "u1") =>
  ({ access_token: "a", refresh_token: "r", expires_at: 9e9, user: { id } }) as unknown as Session;

// ── point 4: a deploy reloads the page; a reload must not cost anyone their session ──

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
const { useAppUpdater } = await import("@/hooks/useAppUpdater");

function Probe() {
  const { session: s, role } = useAuth();
  return <div>{s ? `IN:${role ?? "-"}` : "OUT"}</div>;
}

beforeEach(() => {
  auth.getSession.mockReset();
  auth.signOut.mockClear();
  localStorage.clear();
});

describe("a deploy reloads the page, and a reload is not a sign-out", () => {
  it("the same stored session signs the person back in on the next boot", async () => {
    // A reload is a fresh mount reading the same storage. That is all a deploy does
    // to authentication: `useAppUpdater` calls location.reload() and nothing else.
    auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });

    const first = render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText(/^IN:/)).toBeTruthy());
    first.unmount();

    // …the page reloads here…
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText(/^IN:/)).toBeTruthy());
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe("the version check never touches the session", () => {
  const realFetch = global.fetch;
  const reload = vi.fn();
  beforeEach(() => {
    reload.mockClear();
    // jsdom has no navigation: location.reload() throws "Not implemented", and its
    // `reload` is not redefinable in place. Stub the whole object — `href` is kept
    // because useAppUpdater resolves the asset path against it.
    vi.stubGlobal("location", { href: window.location.href, pathname: "/", reload });
  });
  afterEach(() => { global.fetch = realFetch; vi.unstubAllGlobals(); });

  it("finds a new build, asks for a reload, and leaves auth storage alone", async () => {
    document.head.innerHTML = '<script type="module" src="/assets/index-OLD.js"></script>';
    localStorage.setItem("sb-proj-auth-token", "the-session");
    localStorage.setItem(TABLET_CRED_KEY, JSON.stringify({ refresh_token: "r" }));

    // The deployed index.html now points at a different hashed entry.
    global.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => '<script type="module" src="/assets/index-NEW.js"></script>',
    })) as unknown as typeof fetch;

    const { result } = renderHook(() => useAppUpdater());
    let outcome: string | undefined;
    await act(async () => { outcome = await result.current.checkNow(); });

    expect(outcome).toBe("updated");
    expect(reload).toHaveBeenCalled();
    // The point of the test: a new build is a reload, never a sign-out.
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem("sb-proj-auth-token")).toBe("the-session");
    expect(localStorage.getItem(TABLET_CRED_KEY)).toBeTruthy();
  });
});

// ── the test the twelve were missing ─────────────────────────────────────────────

describe("an origin that has never seen you is not a session that ended", () => {
  it("nothing stored reads as signed-out, not as expired", () => {
    // Landing on anpmsystem.co.uk with the session saved under anmaisys.lovable.app
    // looks exactly like this: no session, no error. It must not be reported as a
    // session that expired — nothing expired, and the fix is not "sign in again and
    // hope", it is re-making the shortcut.
    expect(classifyBootSession({ data: { session: null }, error: null }).kind).toBe("signed-out");
  });

  it("shows the moved-address notice, and not the session-ended one", () => {
    expect(takeSessionEndNotice()).toBeNull();
    expect(movedOriginNotice("https://anmaisys.lovable.app/", "anpmsystem.co.uk"))
      .toMatch(/new address/i);
  });

  it("still says 'your session ended' when that is what actually happened", () => {
    // The two notices must not collapse into each other: an expired session on the
    // right address is a different fact and gets different words.
    noteSessionEnded("expired");
    expect(movedOriginNotice("", "anpmsystem.co.uk")).toBeNull();
    expect(takeSessionEndNotice()).toMatch(/sign-in ended/i);
  });
});

// ── point 11: two tablets keep their own authentication state ────────────────────

describe("two shared tablets do not borrow each other's credentials", () => {
  it("each device answers from its own storage", () => {
    // Tablet identity lives in this device's localStorage and nowhere else — there is
    // no server-side notion of "this tablet", so one tablet's credential can never
    // stand in for another's.
    const lineOne = { getItem: (k: string) => (k === TABLET_CRED_KEY ? '{"refresh_token":"r1"}' : null) };
    const office = { getItem: () => null };

    expect(isSharedTabletSession(lineOne)).toBe(true);
    expect(isSharedTabletSession(office)).toBe(false);
  });

  it("treats blocked storage as a staff screen rather than guessing a tablet", () => {
    const blocked = { getItem: () => { throw new Error("storage disabled"); } };
    expect(isSharedTabletSession(blocked)).toBe(false);
  });
});
