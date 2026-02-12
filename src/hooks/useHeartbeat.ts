import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useHeartbeat() {
  const { user, role } = useAuth();

  useEffect(() => {
    if (!user || role !== "engineer") return;

    const beat = async () => {
      await (supabase as any)
        .from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", user.id);
    };

    beat(); // immediate
    const interval = setInterval(beat, 30_000);
    return () => clearInterval(interval);
  }, [user, role]);
}
