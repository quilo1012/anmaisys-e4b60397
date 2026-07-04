import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Persistent banner shown to admins/managers whenever
 * system_settings.intouch_auto_wo_enabled is OFF, so the team notices
 * that automatic Work Order creation from iTouching is disabled.
 * RLS restricts system_settings reads to admins; managers see nothing
 * if the query silently returns no rows.
 */
export function AutoWoDisabledBanner() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["system_settings_auto_wo_flag"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("intouch_auto_wo_enabled")
        .maybeSingle();
      if (error) return null;
      return data;
    },
  });

  if (!data || data.intouch_auto_wo_enabled !== false) return null;

  return (
    <button
      type="button"
      onClick={() => navigate("/dashboard/intouch-settings")}
      className="w-full flex items-center justify-center gap-2 bg-amber-500/15 text-amber-800 dark:text-amber-200 border-b border-amber-500/30 text-sm py-1.5 px-4 font-medium hover:bg-amber-500/25 transition"
    >
      <AlertTriangle className="h-4 w-4" />
      Auto-WO from iTouching is OFF — no automatic Work Orders are being created. Click to open iTouching Sync.
    </button>
  );
}
