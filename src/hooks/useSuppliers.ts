import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

export type PurchaseOrder = {
  id: string;
  supplier_id: string | null;
  status: "draft" | "sent" | "received" | "cancelled";
  notes: string | null;
  created_by: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
  supplier?: { name: string } | null;
  items?: PurchaseOrderItem[];
};

export type PurchaseOrderItem = {
  id: string;
  purchase_order_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
};

export function useSuppliers() {
  return useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers" as any)
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Supplier[];
    },
  });
}

export function useSupplierMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["suppliers"] });

  const create = useMutation({
    mutationFn: async (input: Partial<Supplier>) => {
      const { error } = await supabase.from("suppliers" as any).insert(input as any);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Supplier> & { id: string }) => {
      const { error } = await supabase.from("suppliers" as any).update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suppliers" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ["purchase_orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders" as any)
        .select("*, supplier:suppliers(name), items:purchase_order_items(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PurchaseOrder[];
    },
  });
}

export function usePurchaseOrderMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["purchase_orders"] });
    qc.invalidateQueries({ queryKey: ["stock"] });
  };

  const create = useMutation({
    mutationFn: async (input: {
      supplier_id: string | null;
      notes?: string | null;
      items: { product_id: string | null; product_name: string; quantity: number; unit_price: number }[];
    }) => {
      const { data: po, error } = await supabase
        .from("purchase_orders" as any)
        .insert({ supplier_id: input.supplier_id, notes: input.notes ?? null, status: "draft" } as any)
        .select("id")
        .single();
      if (error) throw error;
      const poId = (po as any).id as string;
      if (input.items.length) {
        const { error: itemsErr } = await supabase.from("purchase_order_items" as any).insert(
          input.items.map((it) => ({ ...it, purchase_order_id: poId })) as any,
        );
        if (itemsErr) throw itemsErr;
      }
      return poId;
    },
    onSuccess: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PurchaseOrder["status"] }) => {
      // Receiving flips status AND adds items to stock — do it atomically in a
      // transactional RPC (in-DB `quantity = quantity + qty`, idempotent on the
      // PO status). The old client-side read-then-write could wipe on-hand stock
      // if a read returned null, and left partial state on any mid-loop failure.
      if (status === "received") {
        const { error } = await (supabase.rpc as any)("receive_purchase_order", { _po_id: id });
        if (error) throw error;
        return;
      }
      const patch: Record<string, unknown> = { status };
      if (status === "sent") patch.sent_at = new Date().toISOString();
      const { error } = await supabase.from("purchase_orders" as any).update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? "Failed to update purchase order"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("purchase_orders" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete purchase order"),
  });

  return { create, setStatus, remove };
}
