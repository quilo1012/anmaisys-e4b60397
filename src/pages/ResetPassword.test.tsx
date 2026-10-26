import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The client signs in with PKCE (`flowType: 'pkce'`), so a recovery link comes back as
 * `/reset-password?code=…`, never with `#type=recovery`. supabase-js trades the code for
 * a session and announces it as PASSWORD_RECOVERY. The page used to read only the hash:
 * the person who clicked the link was shown "send me a link" again, forever.
 */
type Listener = (event: string, session: unknown) => void;
const listeners = vi.hoisted(() => [] as Listener[]);
const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(async (..._args: unknown[]) => ({ error: null as unknown })),
  updateUser: vi.fn(async (..._args: unknown[]) => ({ error: null as unknown })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((cb: Listener) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      resetPasswordForEmail: auth.resetPasswordForEmail,
      updateUser: auth.updateUser,
    },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import ResetPassword from "@/pages/ResetPassword";

function at(url: string, state?: unknown) {
  window.history.replaceState(null, "", url);
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/reset-password", state }]}>
      <ResetPassword />
    </MemoryRouter>,
  );
}

const newPasswordField = () => screen.queryByLabelText(/new password/i);
const linkDead = () => screen.queryByText(/expired or was already used/i);

describe("ResetPassword", () => {
  beforeEach(() => {
    listeners.length = 0;
    auth.resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
    auth.updateUser.mockReset().mockResolvedValue({ error: null });
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  // ── Unchanged behaviour ────────────────────────────────────────────────
  it("asks for the new password once supabase reports the recovery from a PKCE link", () => {
    at("/reset-password?code=abc");
    expect(newPasswordField()).toBeNull();
    act(() => listeners.forEach((l) => l("PASSWORD_RECOVERY", { user: {} })));
    expect(newPasswordField()).not.toBeNull();
  });

  it("asks for it too when the code was traded before the page was listening", () => {
    at("/reset-password?code=abc");
    act(() => listeners.forEach((l) => l("INITIAL_SESSION", { user: {} })));
    expect(newPasswordField()).not.toBeNull();
  });

  it("still honours the old implicit link, #type=recovery", () => {
    at("/reset-password#access_token=x&type=recovery");
    expect(newPasswordField()).not.toBeNull();
  });

  it("offers to send a link when nobody arrived from one", () => {
    at("/reset-password");
    act(() => listeners.forEach((l) => l("SIGNED_IN", { user: {} })));
    expect(newPasswordField()).toBeNull();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
  });

  // ── Dead links ─────────────────────────────────────────────────────────
  it("says the link is dead when supabase sends it back with an error", () => {
    at("/reset-password?error=access_denied&error_code=otp_expired");
    expect(linkDead()).not.toBeNull();
    expect(newPasswordField()).toBeNull();
  });

  it("says the same for an implicit link that carries an error in the hash", () => {
    at("/reset-password#error=access_denied&error_code=otp_expired");
    expect(linkDead()).not.toBeNull();
  });

  it("says the link is dead when the code could not be traded for a session", () => {
    at("/reset-password?code=used");
    act(() => listeners.forEach((l) => l("INITIAL_SESSION", null)));
    expect(linkDead()).not.toBeNull();
    expect(newPasswordField()).toBeNull();
  });

  it("lets the person ask for a new link from the dead-link screen", () => {
    at("/reset-password?error=access_denied&error_code=otp_expired");
    fireEvent.click(screen.getByRole("button", { name: /send a new link/i }));
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
  });

  it("moves to the dead-link screen if the recovery session is gone on submit", async () => {
    auth.updateUser.mockResolvedValue({ error: { name: "AuthSessionMissingError", message: "Auth session missing!" } });
    at("/reset-password#access_token=x&type=recovery");
    fireEvent.change(newPasswordField()!, { target: { value: "secret123" } });
    fireEvent.change(screen.getByLabelText(/repeat password/i), { target: { value: "secret123" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /update password/i })); });
    expect(linkDead()).not.toBeNull();
  });

  // ── Badge accounts ─────────────────────────────────────────────────────
  it("does not claim to send mail to a badge account address", async () => {
    at("/reset-password");
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "e045@employee.pmsystem.local" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /send recovery link/i })); });
    expect(screen.getByText(/badge accounts can't reset by email/i)).toBeTruthy();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(screen.queryByText(/check your inbox/i)).toBeNull();
  });

  it("treats a badge number typed into the email box the same way", async () => {
    at("/reset-password");
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "E045" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /send recovery link/i })); });
    expect(screen.getByText(/badge accounts can't reset by email/i)).toBeTruthy();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("explains straight away when the sign-in form handed over a badge number", () => {
    at("/reset-password", { identifier: "E045" });
    expect(screen.getByText(/badge accounts can't reset by email/i)).toBeTruthy();
  });

  // ── Hand-over and errors ───────────────────────────────────────────────
  it("keeps the email already typed on the sign-in form, without putting it in the URL", () => {
    at("/reset-password", { identifier: "ana@appliednutrition.uk" });
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe("ana@appliednutrition.uk");
    expect(window.location.search).not.toContain("ana");
  });

  it("turns a rate-limit error into plain English", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({
      error: { status: 429, code: "over_email_send_rate_limit", message: "For security purposes, you can only request this after 53 seconds." },
    });
    at("/reset-password");
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ana@appliednutrition.uk" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /send recovery link/i })); });
    expect(screen.getByRole("alert").textContent).toMatch(/too many requests/i);
    expect(screen.queryByText(/for security purposes/i)).toBeNull();
  });

  it("shows the same confirmation whatever the address, so it says nothing about accounts", async () => {
    at("/reset-password");
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "nobody@appliednutrition.uk" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /send recovery link/i })); });
    expect(screen.getByText(/if that address has an account/i)).toBeTruthy();
  });

  // ── New password ───────────────────────────────────────────────────────
  it("refuses two passwords that don't match, before calling supabase", async () => {
    at("/reset-password#access_token=x&type=recovery");
    fireEvent.change(newPasswordField()!, { target: { value: "secret123" } });
    fireEvent.change(screen.getByLabelText(/repeat password/i), { target: { value: "secret124" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /update password/i })); });
    expect(screen.getByRole("alert").textContent).toMatch(/don't match/i);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("keeps the show-password control reachable from the keyboard", () => {
    at("/reset-password#access_token=x&type=recovery");
    const toggle = screen.getByRole("button", { name: /show password/i });
    expect(toggle.getAttribute("tabindex")).not.toBe("-1");
  });
});
