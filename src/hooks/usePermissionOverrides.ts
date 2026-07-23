import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setPermissionOverrides, setDeviceHidden } from "@/lib/permissions";

/**
 * Loads role/action overrides from the DB and keeps them in sync via realtime.
 * Mount once at the app root.
 */
export function usePermissionOverridesSync() {
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data, error } = await (supabase as any)
        .from("role_permission_overrides")
        .select("role, action, allowed");
      if (!mounted || error || !data) return;
      const map: Record<string, boolean> = {};
      for (const r of data as Array<{ role: string; action: string; allowed: boolean }>) {
        map[`${r.role}:${r.action}`] = r.allowed;
      }
      setPermissionOverrides(map);
    };

    const loadMobile = async () => {
      const { data, error } = await (supabase as any)
        .from("role_mobile_hidden")
        .select("role, action, device");
      if (!mounted || error || !data) return;
      setDeviceHidden((data as Array<{ role: string; action: string; device: string }>).map((r) => `${r.role}:${r.action}:${r.device ?? "mobile"}`));
    };

    load();
    loadMobile();
    const ch = supabase
      .channel("role_permission_overrides_sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_permission_overrides" },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "role_mobile_hidden" },
        () => loadMobile()
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);
}
