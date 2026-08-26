import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/hooks/useWOPhotos";

/**
 * Finding a part by pointing a camera at it.
 *
 * The photograph is a query, not a record: it is shrunk, sent, read and forgotten.
 * Nothing is written to `part-photos` or to any table from here.
 */
export interface PartMatch {
  code: string;
  name: string;
  category: string;
  /** 0..1, as the model judged it. */
  confidence: number;
  /** Why it thinks so, in one sentence — the "and why" of the candidate list. */
  reason: string;
}

export interface IdentifyPartResult {
  /** What the model thought the photographed part was, shown even with no matches. */
  description: string;
  candidates: PartMatch[];
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the photo"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function useIdentifyPart() {
  return useMutation<IdentifyPartResult, Error, File>({
    mutationFn: async (file) => {
      // A warehouse photo off a phone is several megabytes; the model needs pixels,
      // not megapixels.
      const small = await compressImage(file, 1024, 0.6);
      const image = await fileToDataUrl(small);

      const { data, error } = await supabase.functions.invoke("identify-part", { body: { image } });

      if (error) {
        // The function's own message is the useful one — dig it out of the response.
        const ctx = (error as unknown as { context?: Response }).context;
        let message = error.message;
        try {
          const body = ctx ? await ctx.clone().json() : null;
          if (body?.error) message = String(body.error);
        } catch {
          /* keep the transport message */
        }
        throw new Error(message);
      }
      if ((data as { error?: string } | null)?.error) throw new Error(String((data as { error: string }).error));

      const payload = (data ?? {}) as Partial<IdentifyPartResult>;
      return {
        description: payload.description ?? "",
        candidates: Array.isArray(payload.candidates) ? payload.candidates : [],
      };
    },
  });
}
