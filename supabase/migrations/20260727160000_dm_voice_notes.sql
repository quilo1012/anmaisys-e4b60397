-- Voice notes in Direct Messages: an audio_url on the message + a private
-- dm-audio storage bucket. Playback uses short-lived signed URLs. Applied live;
-- kept for the record.
ALTER TABLE public.direct_messages ADD COLUMN IF NOT EXISTS audio_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('dm-audio', 'dm-audio', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users upload their own voice notes; any authenticated user can
-- read (playback is via signed URLs; object paths are random uuids).
DROP POLICY IF EXISTS "dm-audio insert own" ON storage.objects;
CREATE POLICY "dm-audio insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dm-audio' AND owner = auth.uid());

DROP POLICY IF EXISTS "dm-audio read authed" ON storage.objects;
CREATE POLICY "dm-audio read authed" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'dm-audio');

DROP POLICY IF EXISTS "dm-audio delete own" ON storage.objects;
CREATE POLICY "dm-audio delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'dm-audio' AND owner = auth.uid());
