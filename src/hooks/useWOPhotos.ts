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

export async function compressImage(file: File, maxDim = 1920, quality = 0.7): Promise<File> {
  if (file.size <= 1024 * 1024) return file; // skip if already ≤1MB
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
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
      const compressed = await compressImage(file);
      const ext = compressed.name.split(".").pop() || "jpg";
      const path = `${workOrderId}/${photoType}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("wo-photos")
        .upload(path, compressed, { upsert: true });
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

export async function getWOPhotoUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("wo-photos")
    .createSignedUrl(storagePath, 3600); // 1 hour expiry
  if (error || !data?.signedUrl) {
    console.error("Failed to get signed URL:", error?.message);
    return "";
  }
  return data.signedUrl;
}
