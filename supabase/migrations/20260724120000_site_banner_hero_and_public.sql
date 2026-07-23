-- The site's real homepage hero (Shopify "DESKTOP_BANNER") differs from its og:image
-- (a product shot). Prefer the hero, fall back to og:image. Also make the banner
-- readable pre-login (anon) so it can back the Login screen too.

-- Public read — this row only holds a public marketing image URL, no sensitive data.
DROP POLICY IF EXISTS "site_banner read" ON public.site_banner;
CREATE POLICY "site_banner read" ON public.site_banner FOR SELECT USING (true);
GRANT SELECT ON public.site_banner TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_site_banner()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $function$
DECLARE
  html text; img text; ttl text; dsc text;
BEGIN
  SELECT (extensions.http_get('https://appliednutrition.uk/')).content INTO html;
  IF html IS NULL THEN RETURN; END IF;
  -- 1) Prefer the homepage hero banner (Shopify DESKTOP_BANNER asset).
  img := substring(html from '(//[^" ,]*DESKTOP_BANNER[^" ,]*\.jpg[^" ,]*)');
  -- 2) Fall back to the social og:image if the hero can't be found.
  IF img IS NULL THEN
    img := substring(html from 'property="og:image"[^>]*content="([^"]*)"');
    IF img IS NULL THEN img := substring(html from 'content="([^"]*)"[^>]*property="og:image"'); END IF;
  END IF;
  ttl := substring(html from 'property="og:title"[^>]*content="([^"]*)"');
  dsc := substring(html from 'property="og:description"[^>]*content="([^"]*)"');
  IF img IS NOT NULL THEN
    img := replace(img, '&amp;', '&');
    -- Upgrade Shopify thumbnail width (e.g. _300x.) to a crisp hero size.
    img := regexp_replace(img, '_[0-9]+x\.', '_1600x.');
    -- Normalize protocol: Shopify emits protocol-relative //cdn... URLs.
    IF img LIKE '//%' THEN img := 'https:' || img;
    ELSE img := regexp_replace(img, '^http://', 'https://'); END IF;
  END IF;
  ttl := replace(COALESCE(ttl, 'Applied Nutrition'), '&amp;', '&');
  dsc := replace(COALESCE(dsc, ''), '&amp;', '&');
  INSERT INTO public.site_banner (id, image, title, description, updated_at)
  VALUES (true, img, ttl, dsc, now())
  ON CONFLICT (id) DO UPDATE
    SET image = EXCLUDED.image, title = EXCLUDED.title, description = EXCLUDED.description, updated_at = now();
END;
$function$;

-- Repopulate immediately with the hero banner.
SELECT public.refresh_site_banner();
