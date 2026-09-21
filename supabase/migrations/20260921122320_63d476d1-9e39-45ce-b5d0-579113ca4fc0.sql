CREATE TABLE public.technical_info_topics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'table' CHECK (kind IN ('table','pdf')),
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  file_path text,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_info_topics TO authenticated;
GRANT ALL ON public.technical_info_topics TO service_role;

ALTER TABLE public.technical_info_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "technical_info_select_auth" ON public.technical_info_topics
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "technical_info_insert_auth" ON public.technical_info_topics
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "technical_info_update_auth" ON public.technical_info_topics
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "technical_info_delete_auth" ON public.technical_info_topics
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER technical_info_topics_updated_at
  BEFORE UPDATE ON public.technical_info_topics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "technical_docs_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'technical-docs');
CREATE POLICY "technical_docs_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'technical-docs');
CREATE POLICY "technical_docs_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'technical-docs');

INSERT INTO public.technical_info_topics (title, kind, columns, rows, note, sort_order)
VALUES (
  'Palletiser Robot — Pallet configuration',
  'table',
  '["Prog","Pallet","Tub","Boxes per layer","Total layers","Total tubes"]'::jsonb,
  '[["1","EURO","750","6","11","792"],["2","EURO","1000","6","8","576"],["3","STANDARD","750","8","15","1500"],["4","STANDARD","750","8","10","960"],["5","STANDARD","1000","8","13","1248"],["6","STANDARD","750","16","11","792"],["7","STANDARD","750","8","8","768"]]'::jsonb,
  '6 tubes per box',
  10
);