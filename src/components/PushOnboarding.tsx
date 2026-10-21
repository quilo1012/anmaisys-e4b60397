import { useAuth } from "@/contexts/AuthContext";
import { useKeepPushSubscriptionCurrent } from "@/hooks/usePushNotifications";

export function PushOnboarding() {
  const { user } = useAuth();
  useKeepPushSubscriptionCurrent(user?.id);

  return null;
}
