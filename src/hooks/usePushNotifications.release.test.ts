import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Signing out takes this phone off the list. Before, the row stayed until somebody else
 * signed in on the phone, so a shared phone kept buzzing with the last person's messages.
 * And signing out must never wait on, or fail because of, the push service.
 */
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const eq = vi.fn();
const del = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ delete: del }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (...a: unknown[]) => from(...(a as [])) } }));

import { releaseThisDevicePush } from "./usePushNotifications";

const unsubscribe = vi.fn(async () => true);
function installPush(sub: unknown) {
  (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  (window as unknown as { Notification: unknown }).Notification = { permission: "granted" };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: vi.fn(async () => ({ pushManager: { getSubscription: vi.fn(async () => sub) } })) },
  });
}

describe("releaseThisDevicePush", () => {
  beforeEach(() => { vi.clearAllMocks(); eq.mockResolvedValue({ error: null }); });
  afterEach(() => { delete (window as unknown as { PushManager?: unknown }).PushManager; });

  it("deletes this phone's row, by its endpoint, and drops the browser's subscription", async () => {
    installPush({ endpoint: "https://web.push.apple.com/abc", unsubscribe });
    await releaseThisDevicePush();
    expect(from).toHaveBeenCalledWith("push_subscriptions");
    expect(eq).toHaveBeenCalledWith("endpoint", "https://web.push.apple.com/abc");
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("does nothing on a phone that never subscribed", async () => {
    installPush(null);
    await releaseThisDevicePush();
    expect(from).not.toHaveBeenCalled();
  });

  it("never throws: a failing delete does not stop the sign-out", async () => {
    installPush({ endpoint: "https://fcm.googleapis.com/x", unsubscribe });
    eq.mockRejectedValue(new Error("offline"));
    await expect(releaseThisDevicePush()).resolves.toBeUndefined();
  });

  it("does nothing where push cannot work at all", async () => {
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    await releaseThisDevicePush();
    expect(from).not.toHaveBeenCalled();
  });
});
