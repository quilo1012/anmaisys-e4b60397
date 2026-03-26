import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { playAlertSound, stopAlertSound, warmUpAudio, requestNotificationPermission, sendWebNotification, playNotificationChime } from "@/lib/shifts";
import { useToast } from "@/hooks/use-toast";

export function useWOAlerts() {
  const { user, role } = useAuth();
  const { toast } = useToast();

  // Warm up AudioContext on first user gesture
  useEffect(() => {
    if (!role) return;

    const handler = () => {
      warmUpAudio();
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

  // Engineers, Admins & Managers: continuous alert on new WO, stop on received
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

          playAlertSound();
          const wo = payload.new as { id: string; requester_name: string; machine: string; description: string; notified_engineers: string[] | null };
          
          const notifBody = `Requester: ${wo.requester_name} — Machine: ${wo.machine}\n${wo.description}`;
          sendWebNotification("🔔 New Work Order!", notifBody);
          
          toast({
            title: "🔔 New Work Order!",
            description: `Requester: ${wo.requester_name} — Machine: ${wo.machine}\n${wo.description}`,
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
            console.log("[WOAlerts] WO accepted — stopping sound");
            stopAlertSound();
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [role, user, toast]);

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
            playNotificationChime();
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
