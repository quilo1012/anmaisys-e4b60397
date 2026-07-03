import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const PROMPT_KEY = "an_push_prompted_v1";

export function PushOnboarding() {
  const { user } = useAuth();
  const { supported, permission, subscribed, subscribe } = usePushNotifications();

  useEffect(() => {
    if (!user || !supported) return;
    if (permission !== "default" || subscribed) return;
    if (localStorage.getItem(PROMPT_KEY)) return;
    // Delay a touch so we don't block first paint
    const t = setTimeout(() => {
      localStorage.setItem(PROMPT_KEY, "1");
      toast("Enable push notifications?", {
        description: "Get alerted on new Line Chat messages and critical alerts.",
        duration: 15000,
        action: {
          label: "Enable",
          onClick: () => { void subscribe(); },
        },
      });
    }, 2500);
    return () => clearTimeout(t);
  }, [user, supported, permission, subscribed, subscribe]);

  return null;
}
