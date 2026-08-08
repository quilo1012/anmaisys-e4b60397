import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Persistent banner shown to admins/managers whenever
 * system_settings.intouch_auto_wo_enabled is OFF, so the team notices
 * that automatic Maintenance Order creation from iTouching is disabled.
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
    <div className="w-full flex items-center justify-between gap-2 bg-warning/15 text-warning-strong border-b border-warning/30 text-xs py-1 px-3">
      <div className="flex items-center gap-1.5 min-w-0">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Auto-WO from iTouching is OFF — no automatic Maintenance Orders are being created.</span>
      </div>
      <button
        type="button"
        onClick={() => navigate("/dashboard/intouch-settings")}
        className="shrink-0 rounded border border-warning/40 bg-warning/20 hover:bg-warning/30 px-2 py-0.5 text-xs font-semibold"
      >
        Fix
      </button>
    </div>
  );
}
