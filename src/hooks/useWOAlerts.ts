import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isOnShift, playAlertSound } from "@/lib/shifts";
import { useToast } from "@/hooks/use-toast";

export function useWOAlerts() {
  const { user, profile, role } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (role !== "engineer" || !user) return;

    const channel = supabase
      .channel("wo_alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "work_orders" },
        (payload) => {
          if (!isOnShift(profile?.shift ?? null)) return;

          playAlertSound();
          const wo = payload.new as { id: string; line: string; machine: string; description: string; notified_engineers: string[] | null };
          toast({
            title: "🔔 New Work Order!",
            description: `Line: ${wo.line} — Machine: ${wo.machine}\n${wo.description}`,
            duration: 10000,
          });

          // Append current engineer to notified_engineers
          const existing = wo.notified_engineers ?? [];
          if (!existing.includes(user.id)) {
            supabase
              .from("work_orders")
              .update({
                notified_engineers: [...existing, user.id],
              })
              .eq("id", wo.id)
              .then(() => {});
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [role, user, profile, toast]);
}
