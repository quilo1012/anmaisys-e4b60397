import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The client signs in with PKCE (`flowType: 'pkce'`), so a recovery link comes back as
 * `/reset-password?code=…`, never with `#type=recovery`. supabase-js trades the code for
 * a session and announces it as PASSWORD_RECOVERY. The page used to read only the hash:
 * the person who clicked the link was shown "send me a link" again, forever.
 */
type Listener = (event: string, session: unknown) => void;
const listeners = vi.hoisted(() => [] as Listener[]);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((cb: Listener) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ error: null })),
    },
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import ResetPassword from "@/pages/ResetPassword";

function at(url: string) {
  window.history.replaceState(null, "", url);
  return render(
    <MemoryRouter>
      <ResetPassword />
    </MemoryRouter>,
  );
}

const newPasswordField = () => screen.queryByLabelText(/new password/i);

describe("ResetPassword", () => {
  beforeEach(() => {
    listeners.length = 0;
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

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
});
