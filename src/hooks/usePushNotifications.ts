import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as
  | string
  | undefined;

type PermissionState = "default" | "granted" | "denied" | "unsupported";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function usePushNotifications() {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

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
      toast.error("VAPID public key missing (VITE_VAPID_PUBLIC_KEY)");
      return false;
    }
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") {
        toast.warning("Permission denied");
        return false;
      }
      const reg = await registerSW();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const { data: userRes } = await supabase.auth.getUser();
      const user_id = userRes.user?.id;
      if (!user_id) {
        toast.error("Not authenticated");
        return false;
      }
      const json = sub.toJSON() as any;
      const { error } = await (supabase as any)
        .from("push_subscriptions")
        .upsert(
          {
            user_id,
            endpoint: sub.endpoint,
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth,
          },
          { onConflict: "endpoint" }
        );
      if (error) throw error;
      setSubscribed(true);
      toast.success("Push notifications enabled");
      return true;
    } catch (e: any) {
      toast.error(e?.message || "Failed to subscribe");
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

  const sendTest = useCallback(async () => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const user_id = userRes.user?.id;
      if (!user_id) return toast.error("Not authenticated");
      const { error } = await supabase.functions.invoke("send-push", {
        body: {
          user_id,
          title: "Test notification",
          body: "Push is working ✅",
          url: "/",
        },
      });
      if (error) throw error;
      toast.success("Test sent");
    } catch (e: any) {
      toast.error(e?.message || "Failed to send test");
    }
  }, []);

  return {
    supported,
    permission,
    subscribed,
    loading,
    subscribe,
    unsubscribe,
    sendTest,
  };
}
