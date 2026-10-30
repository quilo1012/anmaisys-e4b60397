/**
 * The notifications card. Blocked is the phone's decision and only the phone's settings undo
 * it, so the card says where the switch is on the phone in hand (30/10/2026). And a phone the
 * app registered by itself, after the screen first looked, must not keep asking for a tap.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const push = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/hooks/usePushNotifications", () => ({ usePushNotifications: () => push.state }));

import { OvertimePushNudge } from "./OvertimePushNudge";

const base = { supported: true, environment: { kind: "ready" }, permission: "default", subscribed: false, loading: false, subscribe: vi.fn() };
const setUA = (ua: string, platform = "Linux armv8l") => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
  Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
};

describe("OvertimePushNudge", () => {
  beforeEach(() => { push.state = { ...base }; setUA("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/141 Mobile"); });

  it("offers Turn on while the phone is not registered", () => {
    render(<OvertimePushNudge />);
    expect(screen.getByRole("button", { name: "Turn on" })).toBeInTheDocument();
  });

  it("goes away once the phone is registered", () => {
    push.state = { ...base, subscribed: true };
    const { container } = render(<OvertimePushNudge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("on a blocked Android phone, says where the switch is — the browser and the app icon", () => {
    push.state = { ...base, permission: "denied" };
    render(<OvertimePushNudge />);
    const card = screen.getByTestId("push-blocked");
    expect(card).toHaveTextContent("Notifications are blocked on this phone");
    expect(card).toHaveTextContent(/Site settings/);
    expect(card).toHaveTextContent(/App info → Notifications/);
    expect(screen.queryByRole("button", { name: "Turn on" })).not.toBeInTheDocument();
  });

  it("on a blocked iPhone, points at the iPhone's own Settings", () => {
    setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15", "iPhone");
    push.state = { ...base, permission: "denied" };
    render(<OvertimePushNudge />);
    const card = screen.getByTestId("push-blocked");
    expect(card).toHaveTextContent(/Allow Notifications/);
    expect(card).not.toHaveTextContent(/Site settings/);
  });
});
