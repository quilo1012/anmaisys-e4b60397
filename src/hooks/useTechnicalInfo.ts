import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normaliseTopic, type TechnicalTopic, type TopicKind } from "@/lib/technicalInfo";

const KEY = ["technical-info-topics"];

export function useTechnicalTopics() {
  return useQuery<TechnicalTopic[]>({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("technical_info_topics")
        .select("id, title, kind, columns, rows, note, file_path, sort_order, updated_at")
        .order("sort_order")
        .order("title");
      if (error) throw error;
      return ((data ?? []) as TechnicalTopic[]).map(normaliseTopic);
    },
  });
}

export function useTechnicalTopic(id: string | undefined) {
  return useQuery<TechnicalTopic | null>({
    queryKey: [...KEY, id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("technical_info_topics")
        .select("id, title, kind, columns, rows, note, file_path, sort_order, updated_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? normaliseTopic(data as TechnicalTopic) : null;
    },
  });
}

export function useSaveTechnicalTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<TechnicalTopic> & { id: string }) => {
      const { id, ...fields } = patch;
      const { error } = await (supabase as any).from("technical_info_topics").update(fields).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCreateTechnicalTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title: string; kind: TopicKind; columns?: string[]; file?: File }) => {
      let file_path: string | null = null;
      if (input.file) {
        const path = `${crypto.randomUUID()}-${input.file.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("technical-docs").upload(path, input.file, {
          contentType: input.file.type || "application/pdf",
        });
        if (upErr) throw upErr;
        file_path = path;
      }
      const { data, error } = await (supabase as any)
        .from("technical_info_topics")
        .insert({
          title: input.title,
          kind: input.kind,
          columns: input.kind === "table" ? (input.columns ?? []) : [],
          rows: [],
          file_path,
          created_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteTechnicalTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (topic: TechnicalTopic) => {
      if (topic.file_path) await supabase.storage.from("technical-docs").remove([topic.file_path]);
      const { error } = await (supabase as any).from("technical_info_topics").delete().eq("id", topic.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Private bucket: a document is opened through a short-lived signed link. */
export async function technicalDocUrl(path: string) {
  const { data, error } = await supabase.storage.from("technical-docs").createSignedUrl(path, 60 * 30);
  if (error) throw error;
  return data.signedUrl;
}
