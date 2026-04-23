import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

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

export interface DeviceLinesResult {
  token: string;
  deviceId: string | null;
  allowedLineIds: string[];
  label: string | null;
}

/** Resolves this device's set of allowed line IDs. Self-registers on first call. */
export function useDeviceLines() {
  const [token] = useState(() => getDeviceToken());

  return useQuery<DeviceLinesResult>({
    queryKey: ["device_lines", token],
    queryFn: async () => {
      // Look up the device row
      const { data: existing } = await supabase
        .from("devices" as any)
        .select("id, label")
        .eq("device_token", token)
        .maybeSingle();

      let deviceId: string | null = (existing as any)?.id ?? null;
      let label: string | null = (existing as any)?.label ?? null;

      if (!deviceId) {
        // Self-register as unpaired
        const { data: inserted } = await supabase
          .from("devices" as any)
          .insert({ device_token: token } as any)
          .select("id, label")
          .maybeSingle();
        deviceId = (inserted as any)?.id ?? null;
        label = (inserted as any)?.label ?? null;
      } else {
        // Touch last_seen
        void supabase.rpc("touch_device" as any, { _token: token });
      }

      let allowedLineIds: string[] = [];
      if (deviceId) {
        const { data: rows } = await supabase
          .from("device_lines" as any)
          .select("line_id")
          .eq("device_id", deviceId);
        allowedLineIds = ((rows ?? []) as any[]).map((r) => r.line_id as string);
      }

      return { token, deviceId, allowedLineIds, label };
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** @deprecated Backward-compat alias for cached bundles. Use `useDeviceLines`. */
export const useDeviceLine = useDeviceLines;

export function useAllDevices() {
  return useQuery({
    queryKey: ["devices_all"],
    queryFn: async () => {
      const { data: devices, error } = await supabase
        .from("devices" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const { data: junctions } = await supabase
        .from("device_lines" as any)
        .select("device_id, line_id");

      const { data: lines } = await supabase
        .from("lines" as any)
        .select("id, name");

      const lineMap = new Map(((lines ?? []) as any[]).map((l) => [l.id, l.name]));
      const grouped = new Map<string, { id: string; name: string }[]>();
      ((junctions ?? []) as any[]).forEach((j) => {
        const arr = grouped.get(j.device_id) ?? [];
        arr.push({ id: j.line_id, name: lineMap.get(j.line_id) ?? "Unknown" });
        grouped.set(j.device_id, arr);
      });

      return ((devices ?? []) as any[]).map((d) => ({
        ...d,
        allowed_lines: grouped.get(d.id) ?? [],
      }));
    },
  });
}

export function usePairDeviceLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      token,
      lineIds,
      label,
    }: {
      token: string;
      lineIds: string[];
      label?: string;
    }) => {
      const { error } = await supabase.rpc("pair_device_lines" as any, {
        _token: token,
        _line_ids: lineIds,
        _label: label ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["devices_all"] });
      qc.invalidateQueries({ queryKey: ["device_lines"] });
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
      qc.invalidateQueries({ queryKey: ["device_lines"] });
    },
  });
}
