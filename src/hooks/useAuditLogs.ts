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

/**
 * Recent stock-adjustment events. Drives the "Adjustment History" panel on the
 * Stock page. Returns the latest N entries with the product name resolved.
 */
export function useStockAdjustmentHistory(limit: number = 10) {
  return useQuery({
    queryKey: ["stock_adjustment_history", limit],
    queryFn: async () => {
      const { data: logs, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("action", "adjust_stock")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;

      const productIds = Array.from(
        new Set((logs || []).map((l: any) => l.entity_id).filter(Boolean))
      );
      let nameMap: Record<string, string> = {};
      if (productIds.length > 0) {
        const { data: products } = await supabase
          .from("products")
          .select("id, name, code")
          .in("id", productIds as string[]);
        (products || []).forEach((p: any) => {
          nameMap[p.id] = `${p.name} (${p.code})`;
        });
      }

      return (logs || []).map((l: any) => ({
        id: l.id as string,
        created_at: l.created_at as string,
        user_name: l.user_name as string,
        product_id: l.entity_id as string | null,
        product_label: l.entity_id ? (nameMap[l.entity_id] || "Deleted product") : "—",
        adjustment: Number(l.details?.adjustment ?? 0),
        new_quantity: l.details?.new_quantity ?? null,
      }));
    },
  });
}

export async function logAuditEvent(action: string, entityType: string, entityId?: string, details?: Record<string, any>) {
  try {
    // Route through the edge function so the server captures the real client IP
    // from x-real-ip / x-forwarded-for. The browser cannot send a trustworthy IP.
    const { invokeFunction } = await import("@/lib/invokeFunction");
    const { error } = await invokeFunction("log-audit-event", {
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details: details || {},
    });
    if (error) throw error;
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}

