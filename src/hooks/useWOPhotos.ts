import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface WOPhoto {
  id: string;
  work_order_id: string;
  photo_type: "before" | "after";
  storage_path: string;
  uploaded_by: string;
  created_at: string;
}

export function useWOPhotos(workOrderId: string) {
  return useQuery({
    queryKey: ["wo_photos", workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wo_photos")
        .select("*")
        .eq("work_order_id", workOrderId)
        .order("created_at");
      if (error) throw error;
      return data as WOPhoto[];
    },
    enabled: !!workOrderId,
  });
}

export function useUploadWOPhoto() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      workOrderId,
      photoType,
      file,
    }: {
      workOrderId: string;
      photoType: "before" | "after";
      file: File;
    }) => {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${workOrderId}/${photoType}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("wo-photos")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase.from("wo_photos").insert({
        work_order_id: workOrderId,
        photo_type: photoType,
        storage_path: path,
        uploaded_by: user!.id,
      });
      if (dbError) throw dbError;

      return path;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["wo_photos", vars.workOrderId] });
    },
  });
}

export function getWOPhotoUrl(storagePath: string) {
  const { data } = supabase.storage.from("wo-photos").getPublicUrl(storagePath);
  return data.publicUrl;
}
