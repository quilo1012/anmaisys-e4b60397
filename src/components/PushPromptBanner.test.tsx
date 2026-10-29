import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PushEnvironment } from "@/lib/pushEnvironment";

/**
 * On 21/10 a message to an employee who had never opened My Overtime reached nobody: no
 * phone on the list. The banner is what puts every phone there, so these hold who sees it,
 * what it says, and that it does not nag the people it cannot help.
 */
const state = {
  environment: { kind: "ready" } as PushEnvironment,
  permission: "default" as string,
  subscribed: false,
  loading: false,
  subscribe: vi.fn(),
};
vi.mock("@/hooks/usePushNotifications", () => ({ usePushNotifications: () => state }));

import { PushPromptBanner } from "./PushPromptBanner";

beforeEach(() => {
  state.environment = { kind: "ready" }; state.permission = "default"; state.subscribed = false; state.loading = false;
  state.subscribe = vi.fn();
  try { localStorage.clear(); } catch { /* none */ }
});
afterEach(cleanup);

describe("PushPromptBanner", () => {
  it("asks an employee to turn notifications on, with a button — the tap is what iOS needs", () => {
    render(<PushPromptBanner role="employee" />);
    fireEvent.click(screen.getByRole("button", { name: /Turn on notifications/ }));
    expect(state.subscribe).toHaveBeenCalledTimes(1);
  });

  it("stays away once the phone is on the list", () => {
    state.subscribed = true;
    render(<PushPromptBanner role="employee" />);
    expect(screen.queryByTestId("push-prompt")).toBeNull();
  });

  it("does not appear on a shared operator tablet, or without a role", () => {
    const { rerender } = render(<PushPromptBanner role="operator" />);
    expect(screen.queryByTestId("push-prompt")).toBeNull();
    rerender(<PushPromptBanner role={null} />);
    expect(screen.queryByTestId("push-prompt")).toBeNull();
  });

  it("tells an iPhone in Safari to add the app to the Home Screen, with no button that cannot work", () => {
    state.environment = { kind: "ios-install" };
    render(<PushPromptBanner role="manager" />);
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Turn on notifications/ })).toBeNull();
  });

  it("the iPhone install line can be put away for good, and stays away after a reload", () => {
    state.environment = { kind: "ios-install" };
    const { unmount } = render(<PushPromptBanner role="employee" />);
    fireEvent.click(screen.getByRole("button", { name: "Don't show again" }));
    expect(screen.queryByTestId("push-prompt")).toBeNull();
    unmount();
    // Long after the twelve-hour snooze would have run out.
    localStorage.removeItem("an_push_banner_snooze_until");
    render(<PushPromptBanner role="employee" />);
    expect(screen.queryByTestId("push-prompt")).toBeNull();
  });

  it("putting the install line away does not silence 'turn notifications on' once the app is installed", () => {
    localStorage.setItem("an_install_hint_off", "1");
    render(<PushPromptBanner role="employee" />);
    expect(screen.getByRole("button", { name: /Turn on notifications/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Don't show again" })).toBeNull();
  });

  it("tells an old iPhone to update", () => {
    state.environment = { kind: "ios-too-old", version: "15.8" };
    render(<PushPromptBanner role="employee" />);
    expect(screen.getByText(/iOS 15\.8/)).toBeTruthy();
  });

  it("says how to unblock when permission was refused", () => {
    state.permission = "denied";
    render(<PushPromptBanner role="employee" />);
    expect(screen.getByText(/Settings → Notifications/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Turn on notifications/ })).toBeNull();
  });

  it("a phone that said no can put the unblock line away for good", () => {
    state.permission = "denied";
    const { unmount } = render(<PushPromptBanner role="employee" />);
    fireEvent.click(screen.getByRole("button", { name: "Don't show again" }));
    expect(screen.queryByTestId("push-prompt")).toBeNull();
    unmount();
    localStorage.removeItem("an_push_banner_snooze_until");
    render(<PushPromptBanner role="employee" />);
    expect(screen.queryByTestId("push-prompt")).toBeNull();
  });

  it("putting the unblock line away does not silence 'turn notifications on' once it is unblocked", () => {
    localStorage.setItem("an_push_denied_hint_off", "1");
    render(<PushPromptBanner role="employee" />);
    expect(screen.getByRole("button", { name: /Turn on notifications/ })).toBeTruthy();
  });

  it("is not drawn where push cannot work at all", () => {
    state.environment = { kind: "unsupported" };
    render(<PushPromptBanner role="employee" />);
    expect(screen.queryByTestId("push-prompt")).toBeNull();
  });

  it("'Not now' hides it for a while, and a reload within that time keeps it hidden", () => {
    const first = render(<PushPromptBanner role="employee" />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("push-prompt")).toBeNull();
    first.unmount();
    render(<PushPromptBanner role="employee" />);
    expect(screen.queryByTestId("push-prompt")).toBeNull();
  });

  it("comes back once the snooze is over", () => {
    localStorage.setItem("an_push_banner_snooze_until", String(Date.now() - 1000));
    render(<PushPromptBanner role="employee" />);
    expect(screen.getByTestId("push-prompt")).toBeTruthy();
  });
});
