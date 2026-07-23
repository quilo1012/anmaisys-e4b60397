-- Live banner from appliednutrition.uk on the mobile home. Scraped server-side via the
-- `http` extension (no browser CORS) and refreshed by pg_cron every 30 min, so the app's
-- banner tracks the site's og:image.
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.site_banner (
  id boolean PRIMARY KEY DEFAULT true,
  image text,
  title text,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_banner_singleton CHECK (id)
);
ALTER TABLE public.site_banner ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "site_banner read" ON public.site_banner;
CREATE POLICY "site_banner read" ON public.site_banner FOR SELECT USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.site_banner TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_site_banner()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $function$
DECLARE
  html text; img text; ttl text; dsc text;
BEGIN
  SELECT (extensions.http_get('https://appliednutrition.uk/')).content INTO html;
  IF html IS NULL THEN RETURN; END IF;
  img := substring(html from 'property="og:image"[^>]*content="([^"]*)"');
  IF img IS NULL THEN img := substring(html from 'content="([^"]*)"[^>]*property="og:image"'); END IF;
  ttl := substring(html from 'property="og:title"[^>]*content="([^"]*)"');
  dsc := substring(html from 'property="og:description"[^>]*content="([^"]*)"');
  IF img IS NOT NULL THEN img := replace(regexp_replace(img, '^http://', 'https://'), '&amp;', '&'); END IF;
  ttl := replace(COALESCE(ttl, 'Applied Nutrition'), '&amp;', '&');
  dsc := replace(COALESCE(dsc, ''), '&amp;', '&');
  INSERT INTO public.site_banner (id, image, title, description, updated_at)
  VALUES (true, img, ttl, dsc, now())
  ON CONFLICT (id) DO UPDATE
    SET image = EXCLUDED.image, title = EXCLUDED.title, description = EXCLUDED.description, updated_at = now();
END;
$function$;

-- Populate now + refresh every 30 minutes.
SELECT public.refresh_site_banner();
SELECT cron.unschedule('refresh-site-banner') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='refresh-site-banner');
SELECT cron.schedule('refresh-site-banner', '*/30 * * * *', 'SELECT public.refresh_site_banner();');
