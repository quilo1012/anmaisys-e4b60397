import { useAuth } from "@/contexts/AuthContext";
import { useKeepPushSubscriptionCurrent } from "@/hooks/usePushNotifications";
import { useOpenedNotification } from "@/hooks/useOpenedNotification";

export function PushOnboarding() {
  const { user } = useAuth();
  useKeepPushSubscriptionCurrent(user?.id);
  useOpenedNotification(user?.id);

  return null;
}
