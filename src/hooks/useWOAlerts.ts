import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { playAlertSound, stopAlertSound, warmUpAudio, requestNotificationPermission, sendWebNotification } from "@/lib/shifts";
import { useToast } from "@/hooks/use-toast";

export function useWOAlerts() {
  const { user, role } = useAuth();
  const { toast } = useToast();

  // Warm up AudioContext on first user gesture
  useEffect(() => {
    if (role !== "engineer") return;

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

  useEffect(() => {
    if (role !== "engineer" || !user) return;

    console.log("[WOAlerts] Subscribing to work_orders INSERT for engineer", user.id);

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
          if (updated.status === "in_progress") {
            console.log("[WOAlerts] WO accepted by an engineer — stopping sound");
            stopAlertSound();
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [role, user, toast]);
}
