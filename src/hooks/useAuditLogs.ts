import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, any>;
  ip_address: string | null;
  created_at: string;
}

export function useAuditLogs(filter?: { entityType?: string; search?: string }) {
  return useQuery({
    queryKey: ["audit_logs", filter],
    queryFn: async () => {
      let q = supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (filter?.entityType && filter.entityType !== "all") {
        q = q.eq("entity_type", filter.entityType);
      }

      const { data, error } = await q as any;
      if (error) throw error;
      
      let logs = data as AuditLog[];
      if (filter?.search?.trim()) {
        const term = filter.search.toLowerCase();
        logs = logs.filter((l) =>
          l.user_name.toLowerCase().includes(term) ||
          l.action.toLowerCase().includes(term) ||
          l.entity_type.toLowerCase().includes(term) ||
          (l.entity_id || "").toLowerCase().includes(term)
        );
      }
      return logs;
    },
  });
}

export async function logAuditEvent(action: string, entityType: string, entityId?: string, details?: Record<string, any>) {
  try {
    await supabase.rpc("log_audit_event", {
      _action: action,
      _entity_type: entityType,
      _entity_id: entityId || null,
      _details: details || {},
    } as any);
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}
