/**
 * A phone that is already signed in must not see the sign-in form on its way to the
 * dashboard. The form used to draw while the stored session was still being read,
 * and stayed up until the role arrived.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const auth = vi.hoisted(() => ({
  value: { session: null, role: null, loading: true, silentReLoginInFlight: false } as Record<string, unknown>,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {}, rpc: vi.fn() } }));
vi.mock("@/hooks/useOperatorAccounts", () => ({ usePublicTabletAccounts: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/useLoginBranding", () => ({ useLoginBranding: () => ({ data: null }) }));
vi.mock("@/hooks/useSignupInvite", () => ({ useSignupInviteCode: () => null }));
vi.mock("@/hooks/useAuditLogs", () => ({ logAuditEvent: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/SiteBannerImages", () => ({ SiteBannerImages: () => null }));

import Login from "@/pages/Login";

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard/my-overtime" element={<p>my overtime</p>} />
        <Route path="*" element={<p>somewhere else</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const form = () => screen.queryByRole("button", { name: /sign in/i });

beforeEach(() => {
  auth.value = { session: null, role: null, loading: true, silentReLoginInFlight: false };
});

describe("Login while a session is being restored", () => {
  it("shows a wait, not the form, while the stored session is read", () => {
    renderAt("/login");
    expect(form()).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows a wait while a tablet's silent re-login runs", () => {
    auth.value = { session: null, role: null, loading: false, silentReLoginInFlight: true };
    renderAt("/login");
    expect(form()).toBeNull();
  });

  it("goes straight to `next` when the session is already there", () => {
    auth.value = { session: { user: { id: "u" } }, role: "employee", loading: false, silentReLoginInFlight: false };
    renderAt("/login?next=%2Fdashboard%2Fmy-overtime");
    expect(screen.getByText("my overtime")).toBeInTheDocument();
  });

  it("shows the form once there is no session", () => {
    auth.value = { session: null, role: null, loading: false, silentReLoginInFlight: false };
    renderAt("/login");
    expect(form()).toBeInTheDocument();
  });
});
