import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * The "Enable" button that never saved a phone.
 *
 * It upserted with `onConflict: "endpoint"`, but the only unique key on
 * `push_subscriptions` is `(user_id, endpoint)`, so Postgres refused every save (42P10)
 * and the table held 0 rows on 21/10 — nobody's phone, admins included, could be
 * pushed to, so nothing ever reached a locked screen.
 *
 * And on the first tap the worker was still installing: `pushManager.subscribe` on a
 * registration with no active worker rejects. It has to wait for `serviceWorker.ready`.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const upsert = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u-1" } } })) },
    from: vi.fn(() => ({ upsert })),
    functions: { invoke: vi.fn() },
  },
}));

import { toast } from "sonner";
import { usePushNotifications } from "./usePushNotifications";

const subscription = {
  endpoint: "https://push.example/abc",
  toJSON: () => ({ keys: { p256dh: "p-key", auth: "a-key" } }),
};

let readyResolved = false;
const activeSubscribe = vi.fn(async () => subscription);
// What register() hands back while the worker is still installing: no active worker yet.
const installingRegistration = {
  pushManager: {
    subscribe: vi.fn(async () => {
      throw new DOMException("Subscription failed - no active Service Worker", "AbortError");
    }),
    getSubscription: vi.fn(async () => null),
  },
};
const activeRegistration = { pushManager: { subscribe: activeSubscribe, getSubscription: vi.fn(async () => null) } };

beforeEach(() => {
  vi.clearAllMocks();
  readyResolved = false;
  upsert.mockResolvedValue({ error: null });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => undefined),
      register: vi.fn(async () => installingRegistration),
      get ready() {
        readyResolved = true;
        return Promise.resolve(activeRegistration);
      },
    },
  });
  (window as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  (window as unknown as { Notification: unknown }).Notification = {
    permission: "default",
    requestPermission: vi.fn(async () => "granted"),
  };
});

afterEach(() => {
  delete (window as unknown as { PushManager?: unknown }).PushManager;
});

describe("usePushNotifications.subscribe", () => {
  it("saves the phone against the key the table actually has", async () => {
    const { result } = renderHook(() => usePushNotifications());
    let ok = false;
    await act(async () => { ok = await result.current.subscribe(); });

    expect(ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "u-1", endpoint: subscription.endpoint, p256dh: "p-key", auth: "a-key" },
      { onConflict: "user_id,endpoint" },
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("subscribes through the active worker, not the one still installing", async () => {
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await result.current.subscribe(); });

    expect(readyResolved).toBe(true);
    expect(activeSubscribe).toHaveBeenCalled();
    expect(installingRegistration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("says so when the save is refused, and does not claim it is on", async () => {
    upsert.mockResolvedValue({ error: { message: "refused" } });
    const { result } = renderHook(() => usePushNotifications());
    let ok = true;
    await act(async () => { ok = await result.current.subscribe(); });

    expect(ok).toBe(false);
    expect(result.current.subscribed).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("refused");
  });
});
