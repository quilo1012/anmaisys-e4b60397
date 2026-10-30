import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { PUSH_SAVED_EVENT, useKeepPushSubscriptionCurrent } from "@/hooks/usePushNotifications";
import { useOpenedNotification } from "@/hooks/useOpenedNotification";
import { PUSH_ERROR_EVENT, reportPushDeviceState } from "@/lib/pushDiagnostics";

/**
 * Waits for the start-up re-save (`useKeepPushSubscriptionCurrent`) to settle before
 * reading the phone, so the first row of the day says how things ended up, not how they
 * were half a second in.
 */
const FIRST_REPORT_DELAY_MS = 8_000;

export function PushOnboarding() {
  const { user, role } = useAuth();
  useKeepPushSubscriptionCurrent(user?.id);
  useOpenedNotification(user?.id);
  useReportPushDeviceState(user?.id, role ?? null);

  return null;
}

/**
 * One `PUSH_STATE` row per phone per day, and another when something changed (saved, an
 * error, permission, Home Screen vs tab). `reportPushDeviceState` decides; this only says
 * when to ask it.
 */
function useReportPushDeviceState(userId: string | undefined, role: string | null) {
  useEffect(() => {
    if (!userId) return;
    const report = () => { void reportPushDeviceState(userId, role); };
    const timer = window.setTimeout(report, FIRST_REPORT_DELAY_MS);
    const onVisible = () => { if (document.visibilityState === "visible") report(); };
    window.addEventListener(PUSH_SAVED_EVENT, report);
    window.addEventListener(PUSH_ERROR_EVENT, report);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(PUSH_SAVED_EVENT, report);
      window.removeEventListener(PUSH_ERROR_EVENT, report);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, role]);
}
