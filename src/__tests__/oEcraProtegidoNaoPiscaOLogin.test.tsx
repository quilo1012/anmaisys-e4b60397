import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

/**
 * The guard decides between "wait" and "send them to the password form", and the cost
 * of the two mistakes is not the same.
 *
 * Redirecting a person whose session is merely still loading costs them a password they
 * have already given — on a shared line tablet, one they have to ask a supervisor for.
 * Waiting on a person who really is signed out costs a spinner for a moment. So every
 * "not signed in *yet*" state has to render something other than a redirect, and these
 * tests pin each one, because each is a separate `if` that a refactor can drop.
 *
 * Phase 3 of the tablet session report: points 3, 9, 10 and 12.
 * See `claude/sessao-tablets-mudanca-de-origem-2026-10-22.md`.
 */

const authState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState.current,
}));

const { ProtectedRoute } = await import("@/components/ProtectedRoute");

const SIGNED_IN = {
  session: { user: { id: "u1" } },
  role: "employee" as const,
  isOwner: false,
  profile: { id: "u1", active: true },
  loading: false,
  authError: null,
  silentReLoginInFlight: false,
  reconnecting: false,
  retryAuth: vi.fn(),
  signOut: vi.fn(),
};

function renderAt(path: string, state: Record<string, unknown>) {
  authState.current = state;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>PASSWORD FORM</div>} />
        <Route
          path="/dashboard/*"
          element={
            <ProtectedRoute>
              <div>THE SCREEN</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const sawLoginForm = () => screen.queryByText("PASSWORD FORM") !== null;

beforeEach(() => {
  authState.current = { ...SIGNED_IN };
});

describe("a screen that is still working out who you are", () => {
  it("does not show the password form while the session is loading", () => {
    renderAt("/dashboard/work-orders", { ...SIGNED_IN, session: null, loading: true });
    expect(sawLoginForm()).toBe(false);
  });

  it("does not show the password form while a tablet is silently signing back in", () => {
    // The shared-tablet recovery completes in a few hundred ms. Bouncing to /login in
    // that window asks a whole shift for a password that the tablet already holds.
    renderAt("/dashboard/work-orders", { ...SIGNED_IN, session: null, silentReLoginInFlight: true });
    expect(sawLoginForm()).toBe(false);
  });

  it("does not show the password form while the session cannot be renewed for want of a network", () => {
    // Factory wifi. The session is in storage and valid; only the renewal failed.
    renderAt("/dashboard/work-orders", { ...SIGNED_IN, session: null, reconnecting: true });
    expect(sawLoginForm()).toBe(false);
  });

  it("waits, rather than deciding, when the role has not arrived yet", () => {
    renderAt("/dashboard/work-orders", { ...SIGNED_IN, role: null });
    expect(sawLoginForm()).toBe(false);
    expect(screen.queryByText("THE SCREEN")).toBeNull();
  });
});

describe("a screen that knows you are signed in", () => {
  it("renders on one protected route and on the next", () => {
    // Navigating between protected routes must not re-litigate the session.
    const first = renderAt("/dashboard/work-orders", { ...SIGNED_IN });
    expect(screen.getByText("THE SCREEN")).toBeTruthy();
    first.unmount();
    renderAt("/dashboard/machines", { ...SIGNED_IN });
    expect(screen.getByText("THE SCREEN")).toBeTruthy();
    expect(sawLoginForm()).toBe(false);
  });

  it("survives a permission change without being sent to the password form", () => {
    // Reloading permissions re-renders the guard. A re-render is not a sign-out:
    // an admin editing the matrix must not log people out of the floor.
    const view = renderAt("/dashboard/work-orders", { ...SIGNED_IN });
    view.rerender(
      <MemoryRouter initialEntries={["/dashboard/work-orders"]}>
        <Routes>
          <Route path="/login" element={<div>PASSWORD FORM</div>} />
          <Route
            path="/dashboard/*"
            element={
              <ProtectedRoute>
                <div>THE SCREEN</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(sawLoginForm()).toBe(false);
  });
});

describe("a screen you have signed out of", () => {
  it("sends you to the password form, and back history does not get you in", () => {
    // The tab stays open on a shared tablet. Pressing Back after signing out must not
    // render the screen for the next person holding it.
    renderAt("/dashboard/work-orders", { ...SIGNED_IN, session: null });
    expect(screen.queryByText("THE SCREEN")).toBeNull();
    expect(sawLoginForm()).toBe(true);
  });

  it("offers no screen to a deactivated account, whatever the route", () => {
    renderAt("/dashboard/work-orders", {
      ...SIGNED_IN,
      profile: { id: "u1", active: false },
    });
    expect(screen.queryByText("THE SCREEN")).toBeNull();
  });
});
