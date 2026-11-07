import { useAuth } from "@/contexts/AuthContext";
import { useWOAlerts } from "@/hooks/useWOAlerts";

/**
 * The engineer's new-order siren, listening on every page. It used to be called from the
 * Engineer and Manager dashboards only, so an engineer on Stock, Work Orders or a chat
 * heard nothing when an order came in (07/11/2026, Q4). Mounted once, in App, so there is
 * one channel and one siren, never two.
 */
export function WOAlertsListener() {
  const { role } = useAuth();
  return role === "engineer" ? <EngineerAlerts /> : null;
}

function EngineerAlerts() {
  useWOAlerts();
  return null;
}
