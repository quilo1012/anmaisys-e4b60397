import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Marca `profiles.last_seen_at` enquanto um engineer tem o dashboard aberto.
 *
 * Pela RPC e nao por um PATCH a `profiles`: o PostgREST devolve a linha inteira num
 * `RETURNING *` mesmo quando ninguem a pede, e `authenticated` nao tem SELECT em
 * `labor_rate`. O PATCH devolvia 42501 a cada 30 segundos. Ver 20260916090000.
 */
export function useHeartbeat() {
  const { user, role } = useAuth();

  useEffect(() => {
    if (!user || role !== "engineer") return;

    const beat = async () => {
      await (supabase as any).rpc("touch_last_seen");
    };

    beat(); // immediate
    const interval = setInterval(beat, 30_000);
    return () => clearInterval(interval);
  }, [user, role]);
}
