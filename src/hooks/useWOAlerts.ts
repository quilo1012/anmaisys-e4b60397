import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { stopAlertSound, requestNotificationPermission, sendWebNotification } from "@/lib/shifts";
import { useToast } from "@/hooks/use-toast";
import { useCriticalAlert } from "@/contexts/CriticalAlertContext";

export function useWOAlerts() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const { triggerAlert, acknowledge } = useCriticalAlert();

  // Request notification permission on first user gesture
  useEffect(() => {
    if (!role) return;

    const handler = () => {
      requestNotificationPermission();
      document.removeEventListener("click", handler);
      document.removeEventListener("keydown", handler);
    };
    document.addEventListener("click", handler, { once: true });
    document.addEventListener("keydown", handler, { once: true });

    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [role]);

  // Engineers & Admins: critical full-screen alert + audio loop + vibration
  useEffect(() => {
    if (!role || !user) return;
    if (role !== "engineer" && role !== "admin") return;

    console.log("[WOAlerts] Subscribing to work_orders for engineer/admin", user.id);

    const channel = supabase
      .channel("wo_alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "work_orders" },
        (payload) => {
          console.log("[WOAlerts] Received INSERT payload", payload);
          const wo = payload.new as {
            id: string;
            wo_number: number;
            requester_name: string;
            machine: string;
            description: string;
            priority?: string;
            notified_engineers: string[] | null;
          };

          // Layer 1+3+4: critical alert (audio loop, modal, vibration, flash title, favicon)
          triggerAlert({
            woId: wo.id,
            woNumber: wo.wo_number,
            machine: wo.machine,
            requester: wo.requester_name,
            description: wo.description,
            priority: wo.priority,
          });

          // Background notification (when tab hidden)
          sendWebNotification(
            "🚨 NEW WORK ORDER",
            `${wo.machine} — ${wo.requester_name}\n${wo.description}`
          );

          // Toast as supplementary signal
          toast({
            title: "🚨 New Work Order",
            description: `${wo.machine} — ${wo.requester_name}`,
            duration: 10000,
          });

          const existing = wo.notified_engineers ?? [];
          if (!existing.includes(user.id)) {
            supabase
              .from("work_orders")
              .update({ notified_engineers: [...existing, user.id] })
              .eq("id", wo.id)
              .then(() => {});
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "work_orders" },
        (payload) => {
          const updated = payload.new as { status: string };
          if (["received", "in_progress"].includes(updated.status)) {
            stopAlertSound();
            acknowledge();
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [role, user, toast, triggerAlert, acknowledge]);

  // Operators: single chime when their WO is finished/closed
  useEffect(() => {
    if (role !== "operator" || !user) return;

    console.log("[WOAlerts] Subscribing to operator notifications for", user.id);

    const channel = supabase
      .channel("wo_operator_alerts")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "work_orders" },
        (payload) => {
          const wo = payload.new as { id: string; status: string; operator_id: string; machine: string; wo_number: number };
          if (wo.operator_id !== user.id) return;
          if (["finished", "closed"].includes(wo.status)) {
            console.log("[WOAlerts] Operator WO completed:", wo.id);
            const woLabel = `WO-${String(wo.wo_number).padStart(6, "0")}`;
            sendWebNotification(`✅ ${woLabel} Completed!`, `Machine: ${wo.machine} — Status: ${wo.status}`);
            toast({
              title: `✅ ${woLabel} Completed!`,
              description: `Machine: ${wo.machine} — Your work order has been ${wo.status}.`,
              duration: 8000,
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [role, user, toast]);
}
