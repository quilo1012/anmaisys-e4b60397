import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";

/**
 * "On" is the server holding this phone, not the phone holding a subscription.
 *
 * The cards hid themselves whenever the phone held a subscription. If its save had failed,
 * nothing was ever sent to it (`send-push` reads only the table), and the one card that
 * would have let the person fix it never showed.
 */
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const rows: { endpoint: string }[] = [];
let selectError: unknown = null;
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "u-1" } } } })),
      getUser: vi.fn(async () => ({ data: { user: { id: "u-1" } } })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: selectError ? null : rows, error: selectError })) })),
      insert: vi.fn(async () => ({ error: null })),
    })),
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: vi.fn() },
  },
}));

import { usePushNotifications } from "./usePushNotifications";
import { OvertimePushNudge } from "@/components/workforce/OvertimePushNudge";
import { readLastPushError } from "@/lib/pushDiagnostics";

const ENDPOINT = "https://web.push.apple.com/held-by-this-phone";
const held = { endpoint: ENDPOINT, options: {}, toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }) };
const getSubscription = vi.fn();
const subscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  rows.length = 0;
  selectError = null;
  localStorage.clear();
  getSubscription.mockResolvedValue(held);
  subscribe.mockResolvedValue(held);
  (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  (window as unknown as { Notification: unknown }).Notification = { permission: "granted", requestPermission: vi.fn(async () => "granted") };
  const reg = { active: {}, pushManager: { getSubscription, subscribe } };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: vi.fn(async () => reg), register: vi.fn(async () => reg), ready: Promise.resolve(reg) },
  });
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { PushManager?: unknown }).PushManager;
});

describe("subscribed", () => {
  it("is false when the phone holds a subscription the server does not have", async () => {
    rows.push({ endpoint: "https://web.push.apple.com/another-phone" });
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.registration).toBe("missing"));
    expect(result.current.subscribed).toBe(false);
  });

  it("is true when the server has this phone", async () => {
    rows.push({ endpoint: ENDPOINT });
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.subscribed).toBe(true));
    expect(result.current.registration).toBe("registered");
  });

  it("keeps the phone's own answer when the server cannot be asked (offline)", async () => {
    selectError = { message: "Failed to fetch" };
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.registration).toBe("unknown"));
    expect(result.current.subscribed).toBe(true);
  });
});

describe("the Turn on card", () => {
  it("stays visible when the phone has a subscription but the server registration failed", async () => {
    render(<OvertimePushNudge />);
    // The card is drawn before the phone has been read; what matters is after.
    await waitFor(() => expect(getSubscription).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.getByRole("button", { name: /Turn on/ })).toBeTruthy();
  });

  it("goes away when the server has the phone", async () => {
    rows.push({ endpoint: ENDPOINT });
    render(<OvertimePushNudge />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Turn on/ })).toBeNull());
  });
});

describe("a failed save is remembered for the diagnostics", () => {
  it("records a code, not the message", async () => {
    rpc.mockResolvedValue({ error: { code: "22023", message: `Invalid push subscription ${ENDPOINT}` } });
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await result.current.subscribe(); });
    expect(readLastPushError()).toMatchObject({ stage: "enable", code: "save_refused:22023" });
    expect(localStorage.getItem("an_push_last_error")).not.toContain(ENDPOINT);
  });

  it("is cleared by a save that works", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "22023", message: "x" } }).mockResolvedValue({ error: null });
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await result.current.subscribe(); });
    expect(readLastPushError()).not.toBeNull();
    await act(async () => { await result.current.subscribe(); });
    expect(readLastPushError()).toBeNull();
    expect(result.current.subscribed).toBe(true);
  });
});
