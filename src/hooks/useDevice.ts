import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

const DEVICE_TOKEN_KEY = "an_device_token";

function genToken() {
  // 24-char URL-safe random token
  const arr = new Uint8Array(18);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, "").slice(0, 24);
}

export function getDeviceToken(): string {
  let t = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!t) {
    t = genToken();
    localStorage.setItem(DEVICE_TOKEN_KEY, t);
  }
  return t;
}

export function clearDeviceToken() {
  localStorage.removeItem(DEVICE_TOKEN_KEY);
}

/** Resolves this device's paired line_id (or null if unpaired). Self-registers on first call. */
export function useDeviceLine() {
  const [token] = useState(() => getDeviceToken());

  return useQuery({
    queryKey: ["device_line", token],
    queryFn: async () => {
      // Try to read; if not present, register a row (unpaired)
      const { data: existing } = await supabase
        .from("devices" as any)
        .select("id, line_id, label, paired_at")
        .eq("device_token", token)
        .maybeSingle();

      if (!existing) {
        await supabase.from("devices" as any).insert({ device_token: token } as any);
        return { token, line_id: null as string | null, label: null as string | null };
      }

      // Touch last_seen
      void supabase.rpc("touch_device" as any, { _token: token });

      return {
        token,
        line_id: (existing as any).line_id as string | null,
        label: (existing as any).label as string | null,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAllDevices() {
  return useQuery({
    queryKey: ["devices_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devices" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });
}

export function usePairDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ token, lineId, label }: { token: string; lineId: string; label?: string }) => {
      const { error } = await supabase.rpc("pair_device" as any, {
        _token: token,
        _line_id: lineId,
        _label: label ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices_all"] });
      qc.invalidateQueries({ queryKey: ["device_line"] });
    },
  });
}

export function useUnpairDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deviceId: string) => {
      const { error } = await supabase.rpc("unpair_device" as any, { _device_id: deviceId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices_all"] });
      qc.invalidateQueries({ queryKey: ["device_line"] });
    },
  });
}
