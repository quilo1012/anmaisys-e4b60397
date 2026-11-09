/**
 * 09/11/2026: after the move to the new database, self sign-up was switched off. The
 * code on the floor was right, every phone was told it "isn't valid any more", and a
 * save made from this card left it off again. The card now says so in red while the
 * switch is off, and a save made with it off says what that means.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const env = vi.hoisted(() => ({
  row: { invite_code: "AN-TEST01", enabled: false, invite_expires_at: null, self_signup_role: "employee" },
  updates: [] as unknown[],
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: env.row, error: null }),
    update: (v: unknown) => { env.updates.push(v); return { eq: async () => ({ error: null }) }; },
  });
  return { supabase: { from: () => chain, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("sonner", () => ({ toast: env.toast }));
vi.mock("@/hooks/useSignupQr", () => ({ useSignupQr: () => ({ data: null }) }));

import { SignupSettingsCard } from "@/components/SignupSettingsCard";

describe("Self sign-up card", () => {
  beforeEach(() => {
    env.updates = [];
    env.toast.success.mockReset(); env.toast.warning.mockReset();
    env.row = { ...env.row, enabled: false };
  });

  it("says in red that nobody can register while the switch is off", async () => {
    render(<SignupSettingsCard />);
    expect(await screen.findByTestId("signup-off")).toHaveTextContent(/nobody can create an account/);
  });

  it("warns when it is saved with the switch off", async () => {
    render(<SignupSettingsCard />);
    await screen.findByTestId("signup-off");
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(env.toast.warning).toHaveBeenCalled());
    expect(env.updates[0]).toMatchObject({ enabled: false });
  });

  it("saves it on, and the red notice goes, once the switch is turned on", async () => {
    render(<SignupSettingsCard />);
    await screen.findByTestId("signup-off");
    fireEvent.click(screen.getByRole("switch", { name: /Allow new users to register/ }));
    expect(screen.queryByTestId("signup-off")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(env.toast.success).toHaveBeenCalled());
    expect(env.updates[0]).toMatchObject({ enabled: true, invite_code: "AN-TEST01" });
  });
});
