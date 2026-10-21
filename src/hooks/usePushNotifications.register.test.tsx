import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/**
 * How a phone gets onto a login, and how the test button tells the truth.
 *
 *  - The save goes through `register_push_subscription` (BLOCO 121), which also takes the
 *    phone off any other login. Before that block is pasted the function does not exist and
 *    the plain upsert is used; any OTHER error must not fall back (it would hide a real one).
 *  - "Test sent" is shown only when the push service accepted the push for a phone. The old
 *    button said "Test sent" for `sent: 0`, which is what the server answers when no phone
 *    is registered or the VAPID keys are missing — a green toast for a push nobody got.
 *  - `useKeepPushSubscriptionCurrent` re-saves, and re-subscribes a phone that lost its
 *    subscription, without ever asking permission.
 */
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const upsert = vi.fn();
const rpc = vi.fn();
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u-1" } } })) },
    from: vi.fn(() => ({ upsert })),
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));

import { toast } from "sonner";
import { saveSubscription, useKeepPushSubscriptionCurrent, usePushNotifications } from "./usePushNotifications";

const subscription = { endpoint: "https://web.push.apple.com/abc", toJSON: () => ({ keys: { p256dh: "p-key", auth: "a-key" } }) };

describe("saveSubscription", () => {
  beforeEach(() => { vi.clearAllMocks(); upsert.mockResolvedValue({ error: null }); });

  it("goes through the function that takes the phone off other logins", async () => {
    rpc.mockResolvedValue({ error: null });
    await saveSubscription(subscription, "u-1");
    expect(rpc).toHaveBeenCalledWith("register_push_subscription", expect.objectContaining({
      p_endpoint: subscription.endpoint, p_p256dh: "p-key", p_auth: "a-key",
    }));
    expect(upsert).not.toHaveBeenCalled();
  });

  it("falls back to the plain upsert only while the function is not installed", async () => {
    rpc.mockResolvedValue({ error: { code: "PGRST202", message: "Could not find the function" } });
    await saveSubscription(subscription, "u-1");
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "u-1", endpoint: subscription.endpoint, p256dh: "p-key", auth: "a-key" },
      { onConflict: "user_id,endpoint" },
    );
  });

  it("does not paper over any other error", async () => {
    rpc.mockResolvedValue({ error: { code: "22023", message: "Invalid push subscription" } });
    await expect(saveSubscription(subscription, "u-1")).rejects.toMatchObject({ code: "22023" });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("the test button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
    (window as unknown as { Notification: unknown }).Notification = { permission: "granted", requestPermission: vi.fn() };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: vi.fn(async () => undefined) } });
  });
  afterEach(() => { delete (window as unknown as { PushManager?: unknown }).PushManager; });

  const press = async () => {
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await result.current.sendTest(); });
  };

  it("says a phone was reached only when one was", async () => {
    invoke.mockResolvedValue({ data: { sent: 1, failed: 0, total: 1 }, error: null });
    await press();
    expect(toast.success).toHaveBeenCalledWith("Test sent to 1 phone", expect.anything());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not call it a success when no phone is registered", async () => {
    invoke.mockResolvedValue({ data: { sent: 0, failed: 0, total: 0 }, error: null });
    await press();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/No phone is registered/));
  });

  it("does not call it a success when the server has no VAPID keys", async () => {
    invoke.mockResolvedValue({ data: { sent: 0, failed: 0, total: 0, note: "VAPID not configured" }, error: null });
    await press();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("VAPID not configured");
  });

  it("reports the push service's refusal with its status", async () => {
    invoke.mockResolvedValue({ data: { sent: 0, failed: 1, total: 1, failures: [{ host: "web.push.apple.com", status: 403 }] }, error: null });
    await press();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("403"));
  });

  it("asks for a push that does not write a second bell row", async () => {
    invoke.mockResolvedValue({ data: { sent: 1, failed: 0, total: 1 }, error: null });
    await press();
    expect(invoke).toHaveBeenCalledWith("send-push", { body: expect.objectContaining({ user_id: "u-1", in_app: false }) });
  });
});

describe("useKeepPushSubscriptionCurrent", () => {
  const subscribe = vi.fn();
  const getSubscription = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ error: null });
    (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
    (window as unknown as { Notification: unknown }).Notification = { permission: "granted", requestPermission: vi.fn() };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({ pushManager: { getSubscription, subscribe } })),
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
      },
    });
  });
  afterEach(() => { delete (window as unknown as { PushManager?: unknown }).PushManager; });

  it("saves the subscription the phone already has", async () => {
    getSubscription.mockResolvedValue(subscription);
    renderHook(() => useKeepPushSubscriptionCurrent("u-1"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("register_push_subscription", expect.objectContaining({ p_endpoint: subscription.endpoint })));
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("subscribes again when permission is granted but the phone lost its subscription", async () => {
    getSubscription.mockResolvedValue(null);
    subscribe.mockResolvedValue(subscription);
    renderHook(() => useKeepPushSubscriptionCurrent("u-1"));
    await waitFor(() => expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true })));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
  });

  it("does nothing without permission, and never asks for it", async () => {
    (window as unknown as { Notification: unknown }).Notification = { permission: "default", requestPermission: vi.fn() };
    renderHook(() => useKeepPushSubscriptionCurrent("u-1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(getSubscription).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect((window.Notification as unknown as { requestPermission: () => void }).requestPermission).not.toHaveBeenCalled();
  });

  it("does nothing when nobody is signed in", async () => {
    renderHook(() => useKeepPushSubscriptionCurrent(null));
    await new Promise((r) => setTimeout(r, 20));
    expect(rpc).not.toHaveBeenCalled();
  });
});
