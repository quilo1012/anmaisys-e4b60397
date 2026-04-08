import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export interface Product {
  id: string;
  name: string;
  line: string;
  code: string;
  quantity: number;
  min_stock: number;
  category: string;
  price: number;
  created_at: string;
  updated_at: string;
}

export interface PartUsed {
  id: string;
  work_order_id: string;
  product_id: string;
  quantity: number;
  engineer_id: string;
  created_at: string;
  product?: { name: string; code: string };
  engineer?: { name: string };
}

export function useProducts() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Product[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("products_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        queryClient.invalidateQueries({ queryKey: ["products"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return query;
}

export function useAddProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (product: { name: string; line?: string; code: string; quantity: number; min_stock: number; category: string; price?: number }) => {
      const { data, error } = await supabase.from("products").insert(product).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useUpdateProductStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      const { error } = await supabase.from("products").update({ quantity }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, line, code, quantity, min_stock, category, price }: { id: string; name: string; line?: string; code: string; quantity: number; min_stock: number; category: string; price?: number }) => {
      const { error } = await supabase.from("products").update({ name, line: line ?? '', code, quantity, min_stock, category, price: price ?? 0 }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });
}

export function useRegisterPartsUsed() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (parts: { work_order_id: string; product_id: string; quantity: number; engineer_name?: string }) => {
      const { engineer_name, ...rest } = parts;
      const { data, error } = await supabase
        .from("parts_used")
        .insert({ ...rest, engineer_id: user!.id, engineer_name: engineer_name || "" } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["parts_used"] });
    },
  });
}

export function usePartsUsedByWO(workOrderId: string) {
  return useQuery({
    queryKey: ["parts_used", workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_used")
        .select("*, product:products(name, code), engineer:profiles!parts_used_engineer_id_fkey(name)")
        .eq("work_order_id", workOrderId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as PartUsed[];
    },
    enabled: !!workOrderId,
  });
}

export function useTotalPartsUsedByEngineer(engineerId?: string) {
  return useQuery({
    queryKey: ["parts_used_total", engineerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_used")
        .select("quantity")
        .eq("engineer_id", engineerId!);
      if (error) throw error;
      return data.reduce((sum, r) => sum + r.quantity, 0);
    },
    enabled: !!engineerId,
  });
}

export function usePartsCountByWOs(woIds: string[]) {
  return useQuery({
    queryKey: ["parts_count_by_wo", woIds],
    queryFn: async () => {
      if (!woIds.length) return {} as Record<string, number>;
      const { data, error } = await supabase
        .from("parts_used")
        .select("work_order_id, quantity")
        .in("work_order_id", woIds);
      if (error) throw error;
      const counts: Record<string, number> = {};
      data.forEach((r) => {
        counts[r.work_order_id] = (counts[r.work_order_id] || 0) + r.quantity;
      });
      return counts;
    },
    enabled: woIds.length > 0,
  });
}

export function useTotalPartsUsedToday() {
  return useQuery({
    queryKey: ["parts_used_today"],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("parts_used")
        .select("quantity")
        .gte("created_at", todayStart.toISOString());
      if (error) throw error;
      return data.reduce((sum, r) => sum + r.quantity, 0);
    },
  });
}
