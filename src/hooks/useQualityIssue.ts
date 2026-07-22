import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/hooks/useWOPhotos";

const BUCKET = "quality-photos";

export interface QualityHistoryRow {
  id: string;
  action_id: string;
  changed_by: string | null;
  changed_at: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
}

/** Audit trail for one quality action (create + status/severity changes). */
export function useQualityHistory(actionId?: string) {
  return useQuery({
    queryKey: ["quality_action_history", actionId],
    enabled: !!actionId,
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_action_history" as any)
        .select("*")
        .eq("action_id", actionId as string)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QualityHistoryRow[];
    },
  });
}

/** Signed URL (1h) for a stored photo path. */
export async function getQualityPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    console.error("Failed to get signed URL:", error?.message);
    return "";
  }
  return data.signedUrl;
}

export function useUploadQualityPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ actionId, file, current }: { actionId: string; file: File; current: string[] }) => {
      const compressed = await compressImage(file);
      const path = `${actionId}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, compressed, { upsert: true });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("quality_actions")
        .update({ attachments: [...current, path] })
        .eq("id", actionId);
      if (dbErr) throw dbErr;
      return path;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quality_actions"] }),
  });
}

export function useDeleteQualityPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ actionId, path, current }: { actionId: string; path: string; current: string[] }) => {
      await supabase.storage.from(BUCKET).remove([path]);
      const { error } = await supabase
        .from("quality_actions")
        .update({ attachments: current.filter((p) => p !== path) })
        .eq("id", actionId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quality_actions"] }),
  });
}
