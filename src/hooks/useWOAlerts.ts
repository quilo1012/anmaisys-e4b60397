import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { requestNotificationPermission, sendWebNotification } from "@/lib/shifts";
import { useToast } from "@/hooks/use-toast";
import { useCriticalAlert } from "@/contexts/CriticalAlertContext";
import { isWOAcknowledged, acknowledgeWOLocal } from "@/lib/woAck";

export function useWOAlerts() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const { triggerAlert, acknowledge, audioEnabled, promptEnableAudio } = useCriticalAlert();

  // Request notification permission + unlock alert audio on first user gesture
  useEffect(() => {
    if (!role) return;

    const handler = () => {
      requestNotificationPermission();
      // Engineers & admins must have alert audio unlocked to hear the siren
      if ((role === "engineer" || role === "admin") && !audioEnabled) {
        promptEnableAudio();
      }
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

    

    const channel = supabase
      .channel(`wo_alerts_${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "work_orders", filter: "status=eq.open" },
        (payload) => {
          const wo = payload.new as {
            id: string;
            wo_number: number;
            requester_name: string;
            machine: string;
            description: string;
            priority?: string;
            status: string;
            engineer_id: string | null;
            locked_engineer_id: string | null;
            engineer_notified_acknowledged_at: string | null;
            notified_engineers: string[] | null;
          };

          console.log("[useWOAlerts INSERT]", wo.id, "ack:", wo.engineer_notified_acknowledged_at);

          // Client-side ack gate — survives remount/reconnect/refresh even before server propagates.
          if (isWOAcknowledged(wo.id)) return;
          // Server-side ack gate — never re-fire if already acknowledged.
          if (wo.engineer_notified_acknowledged_at) return;
          // Status gate — only 'open' WOs alert.
          if (wo.status !== "open") return;
          // Targeting gate — if WO is already locked/assigned to another engineer, don't fire.
          if (wo.engineer_id && wo.engineer_id !== user.id) return;
          if (wo.locked_engineer_id && wo.locked_engineer_id !== user.id) return;

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
          const updated = payload.new as { id: string; status: string; engineer_id: string | null };
          console.log("[useWOAlerts UPDATE]", updated.id, updated.status, "eng:", updated.engineer_id);
          // Guard: only ack if this engineer owns the WO (prevents another
          // engineer's status change from closing this engineer's modal).
          if (
            ["received", "in_progress"].includes(updated.status) &&
            updated.engineer_id === user.id
          ) {
            acknowledgeWOLocal(updated.id);
            acknowledge(updated.id);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [role, user, toast, triggerAlert, acknowledge]);

  // Operators: single chime when their WO is finished/closed
  useEffect(() => {
    if (role !== "operator" || !user) return;

    

    const channel = supabase
      .channel("wo_operator_alerts")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "work_orders" },
        (payload) => {
          const wo = payload.new as { id: string; status: string; operator_id: string; machine: string; wo_number: number };
          const old = payload.old as { status?: string };
          if (wo.operator_id !== user.id) return;
          // Only react when status actually changes — avoids spurious chimes on metadata updates.
          if (old?.status === wo.status) return;
          if (["finished", "closed"].includes(wo.status)) {
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
