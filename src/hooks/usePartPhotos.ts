import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/hooks/useWOPhotos";

const BUCKET = "part-photos";

/**
 * Signed addresses for the part photos, asked for in one request.
 *
 * `part-photos` is private, so the stored path is not something a browser can open —
 * the thumbnail has to be a signed URL. Asked in a batch and only for the parts that
 * actually carry a photo, which today is a handful out of a hundred and thirty-seven.
 */
export function usePartPhotoUrls(paths: string[]) {
  // Sorted + joined so the same set of parts, in any order, is one cache entry.
  const key = [...new Set(paths)].sort();
  return useQuery({
    queryKey: ["part_photo_urls", key.join("|")],
    enabled: key.length > 0,
    staleTime: 45 * 60_000, // signed for an hour; refresh before it lapses
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(key, 60 * 60);
      // A signature that fails is not a broken screen: the caller falls back to the
      // same empty square it shows for a part with no photo at all.
      if (error || !data) return {} as Record<string, string>;
      const map: Record<string, string> = {};
      data.forEach((row) => {
        if (row.signedUrl && row.path) map[row.path] = row.signedUrl;
      });
      return map;
    },
  });
}

export function useUploadPartPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, file }: { productId: string; file: File }) => {
      // Phone photos are ten megabytes for a 36-pixel thumbnail. Shrink first.
      const compressed = await compressImage(file, 1280, 0.7);
      const ext = compressed.name.split(".").pop() || "jpg";
      const path = `${productId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, compressed, { upsert: true });
      if (uploadError) throw uploadError;
      const { error } = await supabase.from("products").update({ photo_url: path }).eq("id", productId);
      if (error) throw error;
      return path;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["part_photo_urls"] });
    },
  });
}
