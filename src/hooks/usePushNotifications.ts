import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { VAPID_PUBLIC_KEY as VAPID_KEY_CONST } from "@/lib/vapid";
import { currentPushEnvironment, type PushEnvironment } from "@/lib/pushEnvironment";
import { sameApplicationServerKey, isDifferentKeyError, describeSubscribeError, withTimeout } from "@/lib/pushSubscribe";

const VAPID_PUBLIC_KEY =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || VAPID_KEY_CONST;

type PermissionState = "default" | "granted" | "denied" | "unsupported";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

interface SavedSubscription { endpoint: string; toJSON: () => unknown }

/**
 * Stores this phone against the signed-in login. Goes through `register_push_subscription`
 * (BLOCO 121), which also removes the same phone from any other login — on a shared phone
 * the previous person's row would keep buzzing the device. Until that block is pasted the
 * function does not exist (PGRST202 / 42883) and the plain upsert is used, as before.
 */
export async function saveSubscription(sub: SavedSubscription, userId: string): Promise<void> {
  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  const client = supabase as any;
  if (typeof client.rpc === "function") {
    const { error } = await client.rpc("register_push_subscription", {
      p_endpoint: sub.endpoint, p_p256dh: p256dh, p_auth: auth,
      p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    if (!error) return;
    const missing = error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
    if (!missing) throw error;
  }
  const { error } = await client
    .from("push_subscriptions")
    .upsert(
      { user_id: userId, endpoint: sub.endpoint, p256dh, auth },
      // The table's only unique key is (user_id, endpoint). "endpoint" alone matched
      // no constraint, so Postgres refused every save (42P10): 0 phones on 21/10.
      { onConflict: "user_id,endpoint" },
    );
  if (error) throw error;
}

export function usePushNotifications() {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const environment: PushEnvironment = currentPushEnvironment();
  const supported = environment.kind === "ready";

  useEffect(() => {
    if (!supported) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as PermissionState);
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = await reg?.pushManager.getSubscription();
        setSubscribed(!!sub);
      } catch {
        /* noop */
      }
    })();
  }, [supported]);

  const registerSW = useCallback(async () => {
    if (!supported) throw new Error("Push not supported on this browser");
    const existing = await navigator.serviceWorker.getRegistration("/sw.js");
    if (existing) return existing;
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!supported) {
      toast.error("Push notifications not supported on this browser");
      return false;
    }
    if (!VAPID_PUBLIC_KEY) {
      toast.error("Notifications are not set up on this server yet. Report it — there is nothing to fix on your phone.");
      return false;
    }
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") {
        toast.warning("Notifications stayed off. Tap Turn on again and choose Allow.");
        return false;
      }
      await registerSW();
      // On the first tap the worker register() returns is still installing, and
      // subscribe() on a registration with no active worker rejects. `ready` waits for
      // it — and never rejects, so it is bounded: an unbounded wait is a button that
      // spins for ever and says nothing.
      const reg = await withTimeout(navigator.serviceWorker.ready, 20_000, "Preparing notifications");

      const wantedKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      // A subscription minted under a different key cannot be reused, and the browser
      // will not replace it: it refuses the new one. This app has changed key — it used
      // to read VITE_VAPID_PUBLIC_KEY and now falls back to the constant in lib/vapid —
      // so every phone that said yes under the old value arrives here holding one.
      // Dropping it costs nothing: it is a subscription this server cannot send to.
      const held = await reg.pushManager.getSubscription();
      if (held && !sameApplicationServerKey(held.options?.applicationServerKey, wantedKey)) {
        try { await held.unsubscribe(); } catch { /* gone already is the outcome we wanted */ }
      }

      const mint = () => reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: wantedKey.buffer as ArrayBuffer,
      });
      let sub: PushSubscription;
      try {
        sub = await mint();
      } catch (err) {
        // Belt and braces: some browsers do not report options.applicationServerKey, so
        // the check above cannot see the mismatch and only the refusal reveals it.
        if (!isDifferentKeyError(err)) throw err;
        const stale = await reg.pushManager.getSubscription();
        if (stale) await stale.unsubscribe();
        sub = await mint();
      }
      const { data: userRes } = await supabase.auth.getUser();
      const user_id = userRes.user?.id;
      if (!user_id) {
        toast.error("Not authenticated");
        return false;
      }
      await saveSubscription(sub, user_id);
      setSubscribed(true);
      toast.success("Push notifications enabled");
      return true;
    } catch (e: unknown) {
      toast.error(describeSubscribeError(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, [registerSW, supported]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await (supabase as any)
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Push notifications disabled");
    } catch (e: any) {
      toast.error(e?.message || "Failed to unsubscribe");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * A real send to this login's own phones, through the same `send-push` every alert uses,
   * and an honest answer: "Test sent" only when the push service accepted it for at least one
   * phone. `send-push` answers 200 with sent: 0 when no phone is registered or when the
   * server has no VAPID keys, and the old toast called that a success.
   */
  const sendTest = useCallback(async () => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const user_id = userRes.user?.id;
      if (!user_id) return toast.error("Not authenticated");
      const { data, error } = await supabase.functions.invoke("send-push", {
        body: {
          user_id,
          title: "Test notification",
          body: "Push is working ✅",
          action_url: "/",
          tag: `test:${Date.now()}`,
          in_app: false,
        },
      });
      if (error) throw error;
      const res = (data ?? {}) as { sent?: number; failed?: number; total?: number; note?: string; failures?: { status: number | null }[] };
      if (res.note) return toast.error(res.note);
      if (!res.total) return toast.error("No phone is registered for this login. Tap Enable on the phone first.");
      if (!res.sent) {
        const codes = (res.failures ?? []).map((f) => f.status ?? "network").join(", ");
        return toast.error(`The push service refused the test (${codes || "no reason given"}).`);
      }
      toast.success(`Test sent to ${res.sent} phone${res.sent === 1 ? "" : "s"}`, {
        description: res.failed ? `${res.failed} could not be reached.` : "Lock the screen to see it arrive.",
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to send test");
    }
  }, []);

  return {
    supported,
    environment,
    permission,
    subscribed,
    loading,
    subscribe,
    unsubscribe,
    sendTest,
  };
}

/**
 * Keeps this phone's row true. Runs once per signed-in session, from `PushOnboarding`.
 *
 *  - Permission already granted and a subscription on the device: save it again. That puts
 *    a pruned row back, and — on a shared phone — makes the phone belong to whoever is
 *    signed in now (see `saveSubscription`).
 *  - Permission granted but the device lost its subscription (iOS does, when its push
 *    token rotates): subscribe again. No permission prompt is involved, so it needs no tap.
 *  - The worker's `pushsubscriptionchange` does the same from the worker side and tells the
 *    page here, which is the only side that has the login.
 *
 * Never asks for permission and never shows a toast: asking is the Enable button's job.
 */
export function useKeepPushSubscriptionCurrent(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId || currentPushEnvironment().kind !== "ready") return;
    if (Notification.permission !== "granted") return;
    let cancelled = false;

    const sync = async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        if (!reg) return;
        let sub = await reg.pushManager.getSubscription();
        if (!sub && VAPID_PUBLIC_KEY) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
          });
        }
        if (sub && !cancelled) await saveSubscription(sub, userId);
      } catch (e) {
        console.warn("push sync failed", e);
      }
    };
    void sync();

    const onMessage = (ev: MessageEvent) => { if (ev.data?.type === "push-subscription-changed") void sync(); };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => { cancelled = true; navigator.serviceWorker.removeEventListener("message", onMessage); };
  }, [userId]);
}
