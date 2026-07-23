-- The site's homepage runs a two-slide hero carousel (main "DESKTOP_BANNER" +
-- "Monthly_Deals_<year>_<month>"), each with a desktop and a mobile artwork.
-- Store BOTH slides (as `images` jsonb, desktop+mobile per slide) so the app can
-- rotate them and pick the right variant per device. Also make the banner
-- readable pre-login (anon) so it can back the Login screen too.

ALTER TABLE public.site_banner ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Public read — this row only holds public marketing image URLs, no sensitive data.
DROP POLICY IF EXISTS "site_banner read" ON public.site_banner;
CREATE POLICY "site_banner read" ON public.site_banner FOR SELECT USING (true);
GRANT SELECT ON public.site_banner TO anon, authenticated;

-- Normalize a scraped Shopify CDN URL: unescape, upscale the thumbnail width to a
-- crisp hero size, and force https (Shopify emits protocol-relative //cdn URLs).
CREATE OR REPLACE FUNCTION public._norm_img(u text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r text;
BEGIN
  IF u IS NULL THEN RETURN NULL; END IF;
  r := replace(u, '&amp;', '&');
  r := regexp_replace(r, '_[0-9]+x\.', '_1600x.');
  IF r LIKE '//%' THEN r := 'https:' || r;
  ELSE r := regexp_replace(r, '^http://', 'https://'); END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_site_banner()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'
AS $function$
DECLARE
  html text; slides jsonb := '[]'::jsonb;
  hd text; hm text; dd text; dm text; td text; tm text; ttl text; dsc text;
BEGIN
  SELECT (extensions.http_get('https://appliednutrition.uk/')).content INTO html;
  IF html IS NULL THEN RETURN; END IF;

  -- Slide 1: main homepage hero (DESKTOP_BANNER / MOBILE_BANNER)
  hd := public._norm_img(substring(html from '(//[^" ,]*DESKTOP_BANNER[^" ,]*\.jpg[^" ,]*)'));
  hm := public._norm_img(substring(html from '(//[^" ,]*MOBILE_BANNER[^" ,]*\.jpg[^" ,]*)'));
  -- Slide 2: monthly deals (Desktop / Mobile), matched generically across months
  dd := public._norm_img(substring(html from '(//[^" ,]*Monthly_Deals[^" ,]*Desktop[^" ,]*\.jpg[^" ,]*)'));
  dm := public._norm_img(substring(html from '(//[^" ,]*Monthly_Deals[^" ,]*Mobile[^" ,]*\.jpg[^" ,]*)'));
  -- Slide 3: trust block (Trust_Block_v<n>_<size>x desktop / _mobile_<size>x)
  td := public._norm_img(substring(html from '(//[^" ,]*Trust_Block_v[0-9]+_[0-9]+x\.jpg[^" ,]*)'));
  tm := public._norm_img(substring(html from '(//[^" ,]*Trust_Block_v[0-9]+_mobile_[0-9]+x\.jpg[^" ,]*)'));

  IF hd IS NOT NULL THEN
    slides := slides || jsonb_build_object('desktop', hd, 'mobile', COALESCE(hm, hd));
  END IF;
  IF dd IS NOT NULL THEN
    slides := slides || jsonb_build_object('desktop', dd, 'mobile', COALESCE(dm, dd));
  END IF;
  IF td IS NOT NULL THEN
    slides := slides || jsonb_build_object('desktop', td, 'mobile', COALESCE(tm, td));
  END IF;
  -- Fallback to og:image if none of the banner families were found.
  IF jsonb_array_length(slides) = 0 THEN
    hd := public._norm_img(substring(html from 'property="og:image"[^>]*content="([^"]*)"'));
    IF hd IS NOT NULL THEN slides := slides || jsonb_build_object('desktop', hd, 'mobile', hd); END IF;
  END IF;

  ttl := replace(COALESCE(substring(html from 'property="og:title"[^>]*content="([^"]*)"'), 'Applied Nutrition'), '&amp;', '&');
  dsc := replace(COALESCE(substring(html from 'property="og:description"[^>]*content="([^"]*)"'), ''), '&amp;', '&');

  INSERT INTO public.site_banner (id, image, images, title, description, updated_at)
  VALUES (true, COALESCE(dd, hd, (slides->0->>'desktop')), slides, ttl, dsc, now())
  ON CONFLICT (id) DO UPDATE
    SET image = EXCLUDED.image, images = EXCLUDED.images, title = EXCLUDED.title,
        description = EXCLUDED.description, updated_at = now();
END;
$function$;

-- Repopulate immediately.
SELECT public.refresh_site_banner();
