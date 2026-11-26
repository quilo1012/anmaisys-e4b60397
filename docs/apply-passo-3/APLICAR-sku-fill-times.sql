-- PASTE INTO: AN Maintenance (apblxaaktftinstoidvp) -> Supabase dashboard -> SQL Editor. Run once.
-- Candidate values only: imported data must not replace approved production standards.
CREATE TABLE public.sku_fill_times (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_name text NOT NULL,
  sku_code text NOT NULL,
  product_description text NOT NULL,
  imported_current_seconds numeric,
  suggested_seconds numeric,
  median_seconds numeric,
  sample_shifts integer,
  approved_seconds numeric,
  time_basis text NOT NULL DEFAULT 'unconfirmed',
  units_per_cycle integer,
  source_file text NOT NULL DEFAULT 'fill_times_sugeridos.csv',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (machine_name, sku_code),
  CHECK (approved_seconds IS NULL OR approved_seconds > 0),
  CHECK (suggested_seconds IS NULL OR suggested_seconds > 0),
  CHECK (imported_current_seconds IS NULL OR imported_current_seconds > 0),
  CHECK (median_seconds IS NULL OR median_seconds > 0),
  CHECK (sample_shifts IS NULL OR sample_shifts >= 0),
  CHECK (time_basis IN ('unconfirmed', 'per_unit', 'per_cycle')),
  CHECK (units_per_cycle IS NULL OR units_per_cycle > 0),
  CHECK (approved_seconds IS NULL OR time_basis <> 'unconfirmed'),
  CHECK (approved_seconds IS NULL OR time_basis <> 'per_cycle' OR units_per_cycle IS NOT NULL)
);
GRANT SELECT ON public.sku_fill_times TO authenticated;
GRANT UPDATE (approved_seconds, time_basis, units_per_cycle) ON public.sku_fill_times TO authenticated;
GRANT ALL ON public.sku_fill_times TO service_role;
ALTER TABLE public.sku_fill_times ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SKU managers read fill times" ON public.sku_fill_times FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'));
CREATE POLICY "SKU managers review fill times" ON public.sku_fill_times FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'));

-- Preserve each machine + SKU from the supplied file; no fuzzy SKU merging.
INSERT INTO public.sku_fill_times
  (machine_name, sku_code, product_description, imported_current_seconds, suggested_seconds, median_seconds, sample_shifts)
SELECT machine_name, sku_code, product_description, imported_current_seconds, suggested_seconds, median_seconds, sample_shifts
FROM jsonb_to_recordset($fill_seed$[
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "HMB",
    "product_description": "HMB 500MG 120 VEGGIE CAPS     [HS CODE:2106909285]",
    "imported_current_seconds": 0.7,
    "suggested_seconds": 0.68,
    "median_seconds": 0.71,
    "sample_shifts": 11
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "SOLUCTIONS GUT HEALTH 60 CAPSULES",
    "product_description": "SOLUCTIONS GUT HEALTH  60 CAPSULES",
    "imported_current_seconds": 0.8,
    "suggested_seconds": 0.66,
    "median_seconds": 0.67,
    "sample_shifts": 6
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "ASHWA",
    "product_description": "ASHWAGANDHA KSM66 + ASTRAGIN 60 CAPSULES     [HS CODE:2106909285]",
    "imported_current_seconds": 1.05,
    "suggested_seconds": 0.67,
    "median_seconds": 0.69,
    "sample_shifts": 7
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "SOLCRECAPS",
    "product_description": "SOLUTIONS CREATINE MONOHYDRATE CAPSULES (60 CAPSULES)",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 0.77,
    "median_seconds": 0.8,
    "sample_shifts": 4
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "CITRUSBERGAMONT",
    "product_description": "CITRUS BERGAMONT 25:1 EXTRACT (1,200MG) - 60 CAPSULES [HS CODE:2106909285]",
    "imported_current_seconds": 0.7,
    "suggested_seconds": 0.69,
    "median_seconds": 0.7,
    "sample_shifts": 5
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "ENDURANCE CAFFEINE 90 CAPSULES",
    "product_description": "ENDURANCE CAFFEINE 90 CAPSULES",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 0.58,
    "median_seconds": 0.59,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "SOLUTIONS TURMERIC",
    "product_description": "SOLUTIONS TURMERIC 60 CAPSULES",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 0.77,
    "median_seconds": 0.77,
    "sample_shifts": 4
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "VITAMIN",
    "product_description": "VITAMIN B12 90 CAPSULES",
    "imported_current_seconds": 0.75,
    "suggested_seconds": 0.77,
    "median_seconds": 0.78,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "DIGESTIVE",
    "product_description": "DIGESTIVE ENZYME - 60 CAPSULES [HS CODE:2106909285]",
    "imported_current_seconds": 2.2,
    "suggested_seconds": 0.7,
    "median_seconds": 0.72,
    "sample_shifts": 4
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "SHRED-X 90",
    "product_description": "SHERED-X 90 CAPUSULES",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 0.79,
    "median_seconds": 0.79,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "ENDCAFFE",
    "product_description": "ENDURANCE CAFFEINE - 90 CAPSULES",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 0.71,
    "median_seconds": 0.74,
    "sample_shifts": 4
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "BODYFUELVITAMIN",
    "product_description": "BODY FUEL MULTIVITAMIN - 60 CAPSULES",
    "imported_current_seconds": 2.4,
    "suggested_seconds": 0.72,
    "median_seconds": 0.72,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "TONGKATALI",
    "product_description": "TONGKAT ALI x 60 CAPSULES [HS CODE:2106909285]",
    "imported_current_seconds": 0.69,
    "suggested_seconds": 0.7,
    "median_seconds": 0.73,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "GLP1 DIGEST - 90 CAPSULES",
    "product_description": "GLP1 DIGEST - 90CAPSULES",
    "imported_current_seconds": 0.7,
    "suggested_seconds": 0.69,
    "median_seconds": 0.7,
    "sample_shifts": 4
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "L-ARGININE - 120 CAPSULES",
    "product_description": "L-ARGININE - 120 CAPSULES",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 0.96,
    "median_seconds": 0.96,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "D3",
    "product_description": "VITAMIN D3 - 90 CAPSULES",
    "imported_current_seconds": 0.9,
    "suggested_seconds": 0.58,
    "median_seconds": 0.58,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "TUROK-X",
    "product_description": "TURKESTERONE",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 0.75,
    "median_seconds": 0.75,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "TONGKAT ALI 60CAP",
    "product_description": "TONGKAT ALI 60 CAPSULES",
    "imported_current_seconds": 0.75,
    "suggested_seconds": 0.71,
    "median_seconds": 0.72,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "CLA - L - CARNITINE & GREEN TEA 100",
    "product_description": "CLA L - CARNITINE & GREEN TEA -100",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 0.85,
    "median_seconds": 0.9,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "CLA-LCAR100",
    "product_description": "CLA,  L-CARNITINE & GREEN TEA - 100 CAPSULES     [HS CODE:2106909285]",
    "imported_current_seconds": 0.69,
    "suggested_seconds": 0.7,
    "median_seconds": 0.7,
    "sample_shifts": 1
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "CITRUS BERGAMONT - 60 CAPSULES",
    "product_description": "CITRUS BERGAMONT - 60 CAPSULES",
    "imported_current_seconds": 0.7,
    "suggested_seconds": 0.67,
    "median_seconds": 0.67,
    "sample_shifts": 1
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "CITRUSBERGAMOT",
    "product_description": "CITRUS BERGAMOT 60 CAPSULES",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 0.76,
    "median_seconds": 0.76,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 1",
    "sku_code": "SOLUTIONS BRAIN FUEL 60 CAP",
    "product_description": "SOLUTIONS BRAIN FUEL 60 CAPSULES",
    "imported_current_seconds": 1.1,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "MULTIVITAMIN",
    "product_description": "MULTIVITAMIN 90 CAPSULES",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 0.63,
    "median_seconds": 0.66,
    "sample_shifts": 9
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "CREATINE 3000",
    "product_description": "CREATINE 3000 - 120 CAPSULES",
    "imported_current_seconds": 0.7,
    "suggested_seconds": 0.76,
    "median_seconds": 0.79,
    "sample_shifts": 8
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "BERBERINE",
    "product_description": "BERBERINE 1000MG - 60 CAPSULES",
    "imported_current_seconds": 1.7,
    "suggested_seconds": 0.67,
    "median_seconds": 0.72,
    "sample_shifts": 6
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "TUDCA+NAC",
    "product_description": "TUDCA + NAC 90 CAPSULES",
    "imported_current_seconds": 1.5,
    "suggested_seconds": 0.75,
    "median_seconds": 0.76,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "CRE3000",
    "product_description": "CREATINE 3000 120caps     [HS CODE:2106909285]",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 0.7,
    "median_seconds": 0.74,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "BERBERINE 1000MG",
    "product_description": "BERBERINE 1000MG",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 0.66,
    "median_seconds": 0.71,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "NEUSOLCOLLAGEN",
    "product_description": "NOT FOR EU - SOLUTIONS COLLAGEN 60 CAPSULES [HS CODE:2106102090]",
    "imported_current_seconds": 0.9,
    "suggested_seconds": 0.67,
    "median_seconds": 0.72,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "BFOXYCAPS",
    "product_description": "BODYFUEL OXYBURN CAPSULES - 60 CAPS,  30 SERVS.",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 0.64,
    "median_seconds": 0.65,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "PROBIOTIC",
    "product_description": "PROBIOTIC ADVANCED MULTI_STRAIN FORMULA - 60 CAPSULES     [HS CODE:2106909285]",
    "imported_current_seconds": 1.1,
    "suggested_seconds": 0.78,
    "median_seconds": 0.79,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "ZINC,M&B (ZMA) 90CAPSULES",
    "product_description": "ZINC, MAGNESIUM & B6 (ZMA) 90 CAPSULES",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 0.79,
    "median_seconds": 0.8,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "SOLUTIONS DETOX & DEBLOAT - 60 CAPSULES",
    "product_description": "SOLUTIONS DETOX & DEBLOAT 60 CAPSULES",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 1.17,
    "median_seconds": 1.18,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "MIULTIVITAMIN",
    "product_description": "MULTIVITAMIN -90 CAAPSULES",
    "imported_current_seconds": 3.2,
    "suggested_seconds": 0.69,
    "median_seconds": 0.69,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "MULTVIT",
    "product_description": "MULTIVITAMIN 2 - 90 CAPSULES",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 0.75,
    "median_seconds": 0.75,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "SEXBM 120 CAPSULES",
    "product_description": "SEX BOMB MALE 120CAPSULES",
    "imported_current_seconds": 7.0,
    "suggested_seconds": 0.8,
    "median_seconds": 0.8,
    "sample_shifts": 1
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "GLUT4K",
    "product_description": "GLUTAMINE 4K 120 VEGGI CAPS     [HS CODE:2106909285]",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 0.75,
    "median_seconds": 0.75,
    "sample_shifts": 1
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "ZINC",
    "product_description": "ZINC - 90 CAPSULES",
    "imported_current_seconds": 0.5,
    "suggested_seconds": 0.65,
    "median_seconds": 0.65,
    "sample_shifts": 3
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "HS&N60CAP",
    "product_description": "HAIR, SKIN& NAILS 60CAPSULES",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 0.8,
    "median_seconds": 0.83,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "SOLCOLLAGEN",
    "product_description": "SOLUTIONS COLLAGEN 60 CAPSULES [HS CODE:2106102090]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 0.72,
    "median_seconds": 0.72,
    "sample_shifts": 1
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "TEST-X - 120 CAPSULES",
    "product_description": "TEST-X 120 CAPSULES",
    "imported_current_seconds": 0.7,
    "suggested_seconds": 0.65,
    "median_seconds": 0.66,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "TESTX",
    "product_description": "TEST-X - 120 CAPSULES",
    "imported_current_seconds": 1.1,
    "suggested_seconds": 0.72,
    "median_seconds": 0.77,
    "sample_shifts": 2
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "VIT-C1000",
    "product_description": "VITAMIN-C VEGGIE CAPSULES x100 - 1000MG & ROSE HIPS      [HS CODE:2106909285]",
    "imported_current_seconds": 0.7,
    "suggested_seconds": 0.71,
    "median_seconds": 0.71,
    "sample_shifts": 1
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "SOLUBRAINFUEL",
    "product_description": "SOLUTION BRAIN FUEL - 60 CAPSULES",
    "imported_current_seconds": 2.1,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "CALVITAK2",
    "product_description": "CALCIUM & VITAMIN K2",
    "imported_current_seconds": 1.0,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Capsules Machine 2",
    "sku_code": "CMG",
    "product_description": "CALCIUM & MAGNESIUM 60 CAPSULES     [HS CODE:2106909285]",
    "imported_current_seconds": 1.1,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 1",
    "sku_code": "ABEENG",
    "product_description": "A.B.E 375G ENERGY     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.08,
    "median_seconds": 3.41,
    "sample_shifts": 9
  },
  {
    "machine_name": "Line 1",
    "sku_code": "OCMC6",
    "product_description": "ORIGINAL CRITICAL MASS CHOCOLATE 6Kg [HS CODE:2106108079]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 16.31,
    "median_seconds": 17.67,
    "sample_shifts": 13
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP16DC",
    "product_description": "ESSENTIAL PROTEIN 1.6KG DOUBLE CHOCOLATE  [HS CODE:2106108079]",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 6.16,
    "median_seconds": 6.82,
    "sample_shifts": 13
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BFBP500CB",
    "product_description": "BODYFUEL BEEF PROTEIN 500G CITRUS BURST",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.67,
    "median_seconds": 5.93,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BFBP500BB",
    "product_description": "BODYFUEL BEEF PROTEIN 500G BERRY BLAST",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.22,
    "median_seconds": 5.45,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 1",
    "sku_code": "ABEWT",
    "product_description": "A.B.E 375G WHITE",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.45,
    "median_seconds": 3.69,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 1",
    "sku_code": "SAMPLECO",
    "product_description": "SAMPLE CRITICAL OATS GOLDEN SYRUP",
    "imported_current_seconds": 50.0,
    "suggested_seconds": 48.18,
    "median_seconds": 53.7,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP16CH",
    "product_description": "ESSENTIAL PROTEIN CHOCOLATE HAZELNUT",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 7.32,
    "median_seconds": 7.98,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 1",
    "sku_code": "ABECC",
    "product_description": "A.B.E 375G CHERRY COLA     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.37,
    "median_seconds": 3.44,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CWBAG450S",
    "product_description": "CRITICAL WHEY BAG 450G - STRAWBERRY MILKSHAKE     [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 6.03,
    "median_seconds": 6.68,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 1",
    "sku_code": "KSAABECC",
    "product_description": "A.B.E 375G CHERRY COLA KSA (POWDER)",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.1,
    "median_seconds": 3.29,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "OCMV6",
    "product_description": "ORIGINAL CRITICAL MASS VANILLA 6Kg     [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 17.66,
    "median_seconds": 22.77,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 1",
    "sku_code": "AF91RM",
    "product_description": "AMINO FUEL EAA 91G RASPBERRY MOJITO",
    "imported_current_seconds": 3.3,
    "suggested_seconds": 3.4,
    "median_seconds": 3.58,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP16WCC",
    "product_description": "ESSENTIAL PROTEIN 1.6KG WHITE CHOCOCLATE COCONUT [HS CODE:2106108079]",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 5.9,
    "median_seconds": 6.6,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800DC",
    "product_description": "ESSENTIAL PROTEIN 800G DOUBLE CHOCOLATE  [HS CODE:2106108079]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.24,
    "median_seconds": 5.62,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BFWP900V",
    "product_description": "BODYFUEL WHEY PROTEIN 900G VANILLA MILKSHAKE     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.01,
    "median_seconds": 6.45,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 1",
    "sku_code": "TRABEBR",
    "product_description": "TRANSPARENCY AMAZON A.B.E 375G BLUE RAS     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.05,
    "median_seconds": 3.4,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800V",
    "product_description": "ESSENTIAL PROTEIN 800G VANILLA ICE CREAM [HS CODE:2106108079]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.82,
    "median_seconds": 6.83,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CW825C",
    "product_description": "CRITICAL WHEY 825G CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.06,
    "median_seconds": 5.79,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 1",
    "sku_code": "OCMWC",
    "product_description": "ORIGINAL CRITICAL MASS WHITE CHOCOLATE BUENO 6Kg     [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 14.9,
    "median_seconds": 20.88,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CWBAG450C",
    "product_description": "CRITICAL WHEY BAG 450G - CHOCOLATE MILKSHAKE     [HS CODE:1806907090]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 4.87,
    "median_seconds": 4.99,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "AFCIB",
    "product_description": "AMINO FUEL EAA 390G CANDY ICE BLAST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.04,
    "median_seconds": 4.31,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "AF91CL",
    "product_description": "AMINO FUEL EAA 91G CHERRY LIMEADE",
    "imported_current_seconds": 2.5,
    "suggested_seconds": 2.79,
    "median_seconds": 2.85,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CORTB",
    "product_description": "CREAM OF RICE  2KG TOFFEE BISCUIT",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.74,
    "median_seconds": 6.75,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 1",
    "sku_code": "AFFB",
    "product_description": "AMINO FUEL EAA 390G FRUIT BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.7,
    "median_seconds": 3.92,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "COR1TB",
    "product_description": "CREAM OF RICE 1KG TOFFEE BISCUIT [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.75,
    "median_seconds": 6.02,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "AF91MP",
    "product_description": "AMINO FUEL EAA 91G MILLIONS PINEAPPLE",
    "imported_current_seconds": 3.3,
    "suggested_seconds": 3.39,
    "median_seconds": 3.39,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BCAA450FB",
    "product_description": "BCAA AMINO-HYDRATE 450G FRUIT BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.8,
    "median_seconds": 3.91,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "COL165CT",
    "product_description": "COLLAGEN 165G - CITRUS TWIST     [HS CODE:2106102090]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.33,
    "median_seconds": 3.36,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "AF91CM",
    "product_description": "AMINO FUEL EAA 91G MILLIONS COLA",
    "imported_current_seconds": 2.5,
    "suggested_seconds": 3.16,
    "median_seconds": 3.39,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CLEAR450BM",
    "product_description": "CLEAR PROTEIN 450G - MILLIONS BLACKCURRANT",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 4.5,
    "median_seconds": 4.5,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800CNC",
    "product_description": "ESSENTIAL PROTEIN 800G COOKIES N CREAM  [HS CODE:2106108079]",
    "imported_current_seconds": 4.45,
    "suggested_seconds": 6.01,
    "median_seconds": 6.25,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP16PC",
    "product_description": "ESSENTIAL PROTEIN 1.6KG PEACHES & CREAM  [HS CODE:2106108079]",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 6.72,
    "median_seconds": 8.29,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP16B",
    "product_description": "ESSENTIAL PROTEIN 1.6KG BANANA MILKSHAKE [HS CODE:2106108079]",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 5.61,
    "median_seconds": 6.52,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CW2S",
    "product_description": "CRITICAL WHEY STRAWBERRY",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 9.46,
    "median_seconds": 10.9,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800CH",
    "product_description": "ESSENTIAL PROTEIN 800G CHOCOLATE HAZELNUT  [HS CODE:2106108079]",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 6.85,
    "median_seconds": 6.88,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BFWP900DC",
    "product_description": "BODYFUEL WHEY PROTEIN 900G DOUBLE CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.34,
    "median_seconds": 6.49,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CLEAR450PM",
    "product_description": "CLEAR PROTEIN 450G - MILLIONS PINEAPPLE",
    "imported_current_seconds": 3.75,
    "suggested_seconds": 3.91,
    "median_seconds": 4.09,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "ENERGYENDUBC",
    "product_description": "ENDURANCE  CARB & ELECTROLYTE - ENERGY 1.5Kg - BLACKCURRANT     [HS CODE:2106909285]",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 6.39,
    "median_seconds": 6.5,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CLEAR150PM",
    "product_description": "CLEAR PROTEIN 150G - MILLIONS PINEAPPLE",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.77,
    "median_seconds": 2.95,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "OCMS6",
    "product_description": "ORIGINAL CRITICAL MASS STRAWBERRY 6Kg [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 28.75,
    "median_seconds": 28.94,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CARBBM",
    "product_description": "CARB X 1.2KG - BLACKCURRANT MILLIONS     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.27,
    "median_seconds": 6.29,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800CB",
    "product_description": "ESSENTIAL PROTEIN 800G CARAMEL BISCUIT  [HS CODE:2106108079]",
    "imported_current_seconds": 8.2,
    "suggested_seconds": 7.79,
    "median_seconds": 7.85,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "ENERGYENDULL",
    "product_description": "ENDURANCE  CARB & ELECTROLYTE - ENERGY 1.5Kg  - LEMON & LIME     [HS CODE:2106909285]",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 4.24,
    "median_seconds": 4.41,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP16CB",
    "product_description": "ESSENTIAL PROTEIN 1.6KG CARAMEL BISCUIT  [HS CODE:2106108079]",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 6.7,
    "median_seconds": 6.86,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800PC",
    "product_description": "ESSENTIAL PROTEIN 800G PEACHES & CREAM  [HS CODE:2106108079]",
    "imported_current_seconds": 6.1,
    "suggested_seconds": 7.22,
    "median_seconds": 8.54,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CREHMB",
    "product_description": "CREATINE+ HMB 240G",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.35,
    "median_seconds": 3.35,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "OCMC24",
    "product_description": "ORIGINAL CRITICAL MASS 2.4KG CHOCOLATE [HS CODE:2106108031]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 6.83,
    "median_seconds": 7.31,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "LABELLAPERVAAMINOCF",
    "product_description": "LABEL LAPERVA AMINO EAA 390g CANDY FRUIT UAE",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 4.12,
    "median_seconds": 4.21,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "SAMPLE CW2CBS",
    "product_description": "SAMPLE CRITICAL WHEY CHIQUITA BANANA STRAWBERRY",
    "imported_current_seconds": 62.5,
    "suggested_seconds": 75.02,
    "median_seconds": 98.53,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "ENERGYENDUOB",
    "product_description": "ENDURANCE  CARB & ELECTROLYTE - ENERGY 1.5Kg  - ORANGE BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 7.0,
    "median_seconds": 7.03,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CARBO",
    "product_description": "CARB X 1.2KG - ORANGE BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 8.13,
    "median_seconds": 8.22,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BASIXOAT3KGCHOCOLATE",
    "product_description": "BASIX OAT 3KG CHOCOLATE KSA     [HS CODE:1806205090]",
    "imported_current_seconds": 9.0,
    "suggested_seconds": 9.36,
    "median_seconds": 10.04,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800S",
    "product_description": "ESSENTIAL PROTEIN 800G STRAWBERRY MILKSHAKE  [HS CODE:2106108079]",
    "imported_current_seconds": 6.1,
    "suggested_seconds": 7.36,
    "median_seconds": 7.66,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BFWP900WCP",
    "product_description": "BODYFUEL WHEY PROTEIN 900G WHITE CHOCOLATE PISTACHIO     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 10.83,
    "median_seconds": 13.24,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CARBU",
    "product_description": "CARB X 1.2KG - UNFLAVOURED     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.22,
    "median_seconds": 6.67,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "ISO18C",
    "product_description": "ISO-XP 1.8KG CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.89,
    "median_seconds": 7.69,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BFAMINORM270",
    "product_description": "BODYFUEL AMINOS 270G RASPBERRY MILLIONS     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.53,
    "median_seconds": 3.53,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CARBPM",
    "product_description": "CARB X 1.2KG - PINEAPPLE MILLIONS     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 7.62,
    "median_seconds": 7.65,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "USABEBR",
    "product_description": "US ABE BLUE RAZZ FLAVOUR 390g [HS CODE: 2106909998]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.99,
    "median_seconds": 4.03,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CO3CHOC",
    "product_description": "CRITICAL OATS 3KG CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 9.0,
    "suggested_seconds": 12.06,
    "median_seconds": 13.13,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "PERUBCAA1400BR",
    "product_description": "BCAA AMINO-HYDRATE 1.4KG ICY BLUE RAZ - PERU",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 7.71,
    "median_seconds": 7.73,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "NEUBFWP900WCP",
    "product_description": "NOT FOR EU - BODYFUEL WHEY PROTEIN 900G WHITE CHOCOLATE PISTACHIO",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.47,
    "median_seconds": 6.84,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "TRABECIB",
    "product_description": "TRANSPARENCY AMAZON A.B.E 375G CANDY ICE BLAST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.01,
    "median_seconds": 4.93,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BASIXOATS1.36GS-KSA",
    "product_description": "BASIX OATS 1.36KG/3LB GOLDEN SYRUP KSA",
    "imported_current_seconds": 5.3,
    "suggested_seconds": 10.44,
    "median_seconds": 12.42,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "SLEEPMB",
    "product_description": "SLEEP HEALTH 300G - MIXED BERRIES     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.5,
    "median_seconds": 3.5,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BFWP18DC",
    "product_description": "BODYFUEL WHEY PROTEIN 1.8KG DOUBLE CHOCOLATE",
    "imported_current_seconds": 12.31,
    "suggested_seconds": 5.85,
    "median_seconds": 6.22,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "SAMPLECWC",
    "product_description": "SAMPLE CRITICAL WHEY CHOCOLATE",
    "imported_current_seconds": 52.75,
    "suggested_seconds": 74.91,
    "median_seconds": 118.61,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "AFFS",
    "product_description": "AMINO FUEL EAA 390G FRUIT SALAD     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.61,
    "median_seconds": 4.61,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800IS",
    "product_description": "ESSENTIAL PROTEIN 800G IBIZA SUNSET  [HS CODE:2106108079]",
    "imported_current_seconds": 6.07,
    "suggested_seconds": 6.4,
    "median_seconds": 6.43,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CARBCM",
    "product_description": "CARB X 1.2KG - COLA MILLIONS     [HS CODE:2106909285]",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 6.93,
    "median_seconds": 7.08,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "ABEWM",
    "product_description": "A.B.E 375G WATERMELON    [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.98,
    "median_seconds": 3.98,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BFBP500BR",
    "product_description": "BODYFUEL BEEF PROTEIN 500G BLUE RASPBERRY",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 6.28,
    "median_seconds": 6.52,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "USABESPKW",
    "product_description": "US ABE SOUR PATCH KIDS WATERMELON 390G",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.79,
    "median_seconds": 4.07,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "DYM750C",
    "product_description": "DYNAMIC MASS CHOCOLATE  750G",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 7.49,
    "median_seconds": 7.49,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "OCMCC6",
    "product_description": "ORIGINAL CRITICAL MASS COOKIES & CREAM 6Kg [HS CODE:2106108079]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 18.78,
    "median_seconds": 20.22,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "DYM750V",
    "product_description": "DYNAMIC MASS VANILLA 750G",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 7.47,
    "median_seconds": 7.47,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400V",
    "product_description": "ESSENTIAL PROTEIN 400G VANILLA ICE CREAM [HS CODE:2106108079]",
    "imported_current_seconds": 4.5,
    "suggested_seconds": 6.63,
    "median_seconds": 6.63,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "AUABEAPL",
    "product_description": "A.B.E 375G SOUR APPLE AU     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.19,
    "median_seconds": 4.19,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "TRABETROP",
    "product_description": "TRANSPARENCY AMAZON A.B.E 375G TROPICAL     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.91,
    "median_seconds": 3.91,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "TRABEWH",
    "product_description": "TRANSPARENCY AMAZON A.B.E 375G WHITE",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.88,
    "median_seconds": 3.88,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "OCM",
    "product_description": "ORIGINAL CRITICAL MASS BANANA 6Kg [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 15.91,
    "median_seconds": 17.63,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 1",
    "sku_code": "ABESP",
    "product_description": "A.B.E 375G SLUSH PUPPIE     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.1,
    "median_seconds": 3.17,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BFPWWS320",
    "product_description": "BODYFUEL PRE-WORKOUT WATERMELON SPLASH 320G [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.87,
    "median_seconds": 2.87,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "P3GBRZERO",
    "product_description": "PUMP 3G 375g ZERO ICY BLUE RAZ     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.69,
    "median_seconds": 3.69,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "PERUBCAA1400FB",
    "product_description": "BCAA AMINO-HYDRATE1.4KG FRUIT BURST PERU",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 6.98,
    "median_seconds": 6.99,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800SC",
    "product_description": "ESSENTIAL PROTEIN 800G SALTED CARAMEL  [HS CODE:2106108079]",
    "imported_current_seconds": 9.88,
    "suggested_seconds": 6.26,
    "median_seconds": 6.26,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "P3GBR",
    "product_description": "PUMP 3G 375g ICY BLUE RAZ     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.73,
    "median_seconds": 3.73,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "SAMPLECWFR",
    "product_description": "SAMPLE CRITICAL WHEY FRAPPE",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 102.54,
    "median_seconds": 102.54,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "SAMPLE CW2S",
    "product_description": "SAMPLE CRITICAL WHEY STRAWBERRY",
    "imported_current_seconds": 60.0,
    "suggested_seconds": 63.2,
    "median_seconds": 63.2,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BASIXOAT3KGBANANA",
    "product_description": "BASIX OAT 3KG BANANA KSA     [HS CODE:2106108070]",
    "imported_current_seconds": 8.25,
    "suggested_seconds": 6.34,
    "median_seconds": 6.34,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400CNC",
    "product_description": "ESSENTIAL PROTEIN 400G COOKIES N CREAM  [HS CODE:2106108079]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.15,
    "median_seconds": 6.15,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "TRABEBB",
    "product_description": "TRANSPARENCY AMAZON A.B.E 375G BUBBLEGUM     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.37,
    "median_seconds": 3.37,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "LAPERVATEST",
    "product_description": "LAPERVA MUSCLE TESTO MOJITO 275G",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.95,
    "median_seconds": 2.95,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CLEAR450CM",
    "product_description": "CLEAR PROTEIN 450G - MILLIONS COLA",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 4.84,
    "median_seconds": 4.84,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "COBAG600CC",
    "product_description": "CRITICAL OATS 600G COOKIES AND CREAM     [HS CODE:1806205090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.44,
    "median_seconds": 6.44,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "OCMV24",
    "product_description": "ORIGINAL CRITICAL MASS CHOCOLATE 2.4KG",
    "imported_current_seconds": 10.62,
    "suggested_seconds": 7.84,
    "median_seconds": 8.48,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "LAPERVAOATS2LBGS",
    "product_description": "LAPERVA OATS 2LB UAE GOLDEN SYRUP",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 9.62,
    "median_seconds": 10.79,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BCAA450AP",
    "product_description": "BCAA AMINO-HYDRATE 450G GREEN APPLE     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.02,
    "median_seconds": 4.22,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BCAA450BR",
    "product_description": "BCAA AMINO-HYDRATE 450G ICY BLUE RAZ     [HS CODE:2106909285]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 4.06,
    "median_seconds": 4.06,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BASIXOAT3KGGS",
    "product_description": "BASIX OAT 3KG GOLDEN SYRUP KSA     [HS CODE:2106108070]",
    "imported_current_seconds": 7.75,
    "suggested_seconds": 9.43,
    "median_seconds": 9.59,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BREATHEENDUOB",
    "product_description": "ENDURANCE CARB & ELECTROLYTE - BREATHE  1.5KG ORANGE BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 6.91,
    "median_seconds": 7.03,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "TRABESG",
    "product_description": "TRANSPARENCY AMAZON A.B.E 375G SOUR GUMMY BEAR     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.24,
    "median_seconds": 3.24,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800WCC",
    "product_description": "ESSENTIAL PROTEIN 800G WHITE CHOCOCLATE COCONUT  [HS CODE:2106108079]",
    "imported_current_seconds": 4.5,
    "suggested_seconds": 5.76,
    "median_seconds": 5.76,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400S",
    "product_description": "ESSENTIAL PROTEIN 400G STRAWBERRY MILKSHAKE  [HS CODE:2106108079]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 5.03,
    "median_seconds": 5.03,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "COBAG600GS",
    "product_description": "CRITICAL OATS 600G GOLDEN SYRUP     [HS CODE:2106108070]",
    "imported_current_seconds": 4.5,
    "suggested_seconds": 5.83,
    "median_seconds": 5.83,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "COBAG600SC",
    "product_description": "CRITICAL OATS 600G SALTED CARAMEL     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.71,
    "median_seconds": 5.84,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "P3GFBZERO",
    "product_description": "PUMP 3G 375g ZERO FRUIT BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.11,
    "median_seconds": 3.11,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "COBAG600C",
    "product_description": "CRITICAL OATS 600G CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.74,
    "median_seconds": 5.74,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "AFBR",
    "product_description": "AMINO FUEL EAA 390G ICY BLUE RAZ     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.13,
    "median_seconds": 3.13,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400B",
    "product_description": "ESSENTIAL PROTEIN 400G BANANA MILKSHAKE  [HS CODE:2106108079]",
    "imported_current_seconds": 4.5,
    "suggested_seconds": 5.82,
    "median_seconds": 5.82,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BASIXCOMPLETE10BT",
    "product_description": "BASIX COMPLETE 10 EAA 405G KSA BERRYTONIC",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 3.82,
    "median_seconds": 3.82,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BREATHEENDUBC",
    "product_description": "ENDURANCE CARB & ELECTROLYTE - BREATHE 1.5Kg - BLACKCURRANT     [HS CODE:2106909285]",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 7.06,
    "median_seconds": 7.32,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "SAMPLE CW2WCP",
    "product_description": "SAMPLE CRITICAL WHEY WHITE CHOC. PISTACHIO",
    "imported_current_seconds": 35.0,
    "suggested_seconds": 53.56,
    "median_seconds": 57.63,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400CH",
    "product_description": "ESSENTIAL PROTEIN 400G CHOCOLATE HAZELNUT  [HS CODE:2106108079]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 5.84,
    "median_seconds": 5.84,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400SC",
    "product_description": "ESSENTIAL PROTEIN 400G SALTED CARAMEL [HS CODE:2106108079]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.55,
    "median_seconds": 4.55,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BASIXOATS3KGCOCO-KSA",
    "product_description": "BASIX OATS 3KG COCONUT KSA",
    "imported_current_seconds": 8.25,
    "suggested_seconds": 12.68,
    "median_seconds": 12.68,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "USABESPKREDBERRY",
    "product_description": "US ABE SOUR PATCH KIDS REDBERRY FLAVOUR 390g",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 3.28,
    "median_seconds": 3.28,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "SAMPLE CW2V",
    "product_description": "SAMPLE CRITICAL WHEY 2KG VANILLA",
    "imported_current_seconds": 65.5,
    "suggested_seconds": 219.12,
    "median_seconds": 459.27,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP16SC",
    "product_description": "ESSENTIAL PROTEIN 1.6KG SALTED CARAMEL",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 7.38,
    "median_seconds": 7.85,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 1",
    "sku_code": "USABESPTC",
    "product_description": "USA ABE SLUSH PUPPIE TWISTED CITRUS 390G",
    "imported_current_seconds": 4.22,
    "suggested_seconds": 3.13,
    "median_seconds": 3.13,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400DC",
    "product_description": "ESSENTIAL PROTEIN 400G DOUBLE CHOCOLATE  [HS CODE:2106108079]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.83,
    "median_seconds": 3.83,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "USABESP",
    "product_description": "US A.B.E 390G SLUSH PUPPIE     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.71,
    "median_seconds": 3.71,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "NEUBFWP900V",
    "product_description": "NOT FOR EU - BODYFUEL WHEY PROTEIN 900G VANILLA MILKSHAKE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.38,
    "median_seconds": 6.38,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400WCC",
    "product_description": "ESSENTIAL PROTEIN 400G WHITE CHOCOCLATE COCONUT [HS CODE:2106108079]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 5.62,
    "median_seconds": 5.62,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400CB",
    "product_description": "ESSENTIAL PROTEIN 400G CARAMEL BISCUIT  [HS CODE:2106108079]",
    "imported_current_seconds": 8.55,
    "suggested_seconds": 4.66,
    "median_seconds": 4.66,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CARBFB",
    "product_description": "CARB X 1.2KG - FRUIT BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 6.39,
    "median_seconds": 6.39,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP800B",
    "product_description": "ESSENTIAL PROTEIN 800G BANANA MILKSHAKE  [HS CODE:2106108079]",
    "imported_current_seconds": 6.3,
    "suggested_seconds": 6.3,
    "median_seconds": 6.3,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BCAA450OM",
    "product_description": "BCAA AMINO-HYDRATE 450G ORANGE & MANGO     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.61,
    "median_seconds": 3.61,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400PC",
    "product_description": "ESSENTIAL PROTEIN 400G PEACHES & CREAM [HS CODE:2106108079]",
    "imported_current_seconds": 8.55,
    "suggested_seconds": 4.58,
    "median_seconds": 4.58,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "EP400IS",
    "product_description": "ESSENTIAL PROTEIN 400G IBIZA SUNSET [HS CODE:2106108079]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.65,
    "median_seconds": 4.65,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CW825BUENO",
    "product_description": "CRITICAL WHEY 825G CHOCO HAZELNUT (BUENO)     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.61,
    "median_seconds": 6.61,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "BCAA450PA",
    "product_description": "BCAA AMINO-HYDRATE 450G PINEAPPLE     [HS CODE:2106909285]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 3.22,
    "median_seconds": 3.22,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "USABERH",
    "product_description": "US ABE RED HAWAIIAN FLAVOUR 390g [HS CODE: 2106909998]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.36,
    "median_seconds": 4.36,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "CW825V",
    "product_description": "CRITICAL WHEY 825G VANILLA [HS CODE:2106108079]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.52,
    "median_seconds": 5.52,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "OCMS24",
    "product_description": "ORIGINAL CRITICAL MASS 2.4KG STRAWBERRY [HS CODE:2106108031]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 1",
    "sku_code": "OCMCC24",
    "product_description": "ORIGINAL CRITICAL MASS 2.4KG COOKIES AND CREAM [HS CODE:2106108031]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.98,
    "median_seconds": 7.98,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 1",
    "sku_code": "GLP1C+EP",
    "product_description": "GLP1 CREATINE+ENERGY PINEAPPLE - SAMPLE",
    "imported_current_seconds": 120.0,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 2",
    "sku_code": "COL165SR",
    "product_description": "COLLAGEN 165G - STRAWBERRY AND RASPBERRY     [HS CODE:2106102090]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.47,
    "median_seconds": 3.69,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 2",
    "sku_code": "COLPEP",
    "product_description": "COLLAGEN PEPTIDES 300G     [HS CODE:2106102090]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.22,
    "median_seconds": 4.46,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 2",
    "sku_code": "COLMAR",
    "product_description": "MARINE COLLAGEN  300G     [HS CODE:2106102090]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.7,
    "median_seconds": 3.77,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.77,
    "median_seconds": 6.6,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BFAMINOCM270",
    "product_description": "BODYFUEL AMINOS 270G COLA MILLIONS     [HS CODE:2106909285]",
    "imported_current_seconds": 5.16,
    "suggested_seconds": 3.72,
    "median_seconds": 3.99,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BFPWWS320",
    "product_description": "BODYFUEL PRE-WORKOUT WATERMELON SPLASH 320G [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.19,
    "median_seconds": 3.64,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BFAMINORM270",
    "product_description": "BODYFUEL AMINOS 270G RASPBERRY MILLIONS     [HS CODE:2106909285]",
    "imported_current_seconds": 3.2,
    "suggested_seconds": 3.42,
    "median_seconds": 3.85,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 2",
    "sku_code": "GLUT250",
    "product_description": "GLUTAMINE POWDER 250g     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.42,
    "median_seconds": 3.58,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 2",
    "sku_code": "ABEFP",
    "product_description": "A.B.E 375G FRUIT PUNCH     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.16,
    "median_seconds": 3.39,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CWBAG450V",
    "product_description": "CRITICAL WHEY BAG 450G - VANILLA ICE CREAM     [HS CODE:2106108070]",
    "imported_current_seconds": 4.32,
    "suggested_seconds": 5.58,
    "median_seconds": 6.34,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 2",
    "sku_code": "COL165CT",
    "product_description": "COLLAGEN 165G - CITRUS TWIST     [HS CODE:2106102090]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.2,
    "median_seconds": 3.23,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "USABESPKIDSBR",
    "product_description": "US ABE SOUR PATCH KIDS 260G BLUE RASPBERRY",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.74,
    "median_seconds": 4.17,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 2",
    "sku_code": "COLMARSR",
    "product_description": "MARINE COLLAGEN STRAWBERRY RASPBERRY 300G     [HS CODE:2106102090]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.98,
    "median_seconds": 4.0,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BFPWSL320",
    "product_description": "BODYFUEL PRE-WORKOUT STRAWBERRY LEMONADE 320G     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.35,
    "median_seconds": 3.45,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PUMPABERH",
    "product_description": "ABE PUMP 500G - RED HAWAIIAN     [HS CODE:2106909285]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 3.82,
    "median_seconds": 3.92,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PUMPABETB",
    "product_description": "ABE PUMP 500G - TIGERS BLOOD     [HS CODE:2106909285]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 3.88,
    "median_seconds": 3.92,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AFFB",
    "product_description": "AMINO FUEL EAA 390G FRUIT BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.72,
    "median_seconds": 3.99,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 2",
    "sku_code": "ABE250BR",
    "product_description": "A.B.E 250G ICY BLUE RAZ [HS CODE:2106909285]",
    "imported_current_seconds": 3.2,
    "suggested_seconds": 3.57,
    "median_seconds": 3.64,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BFBP500BB",
    "product_description": "BODYFUEL BEEF PROTEIN 500G BERRY BLAST",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 6.53,
    "median_seconds": 6.92,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "ABETROP",
    "product_description": "A.B.E 375G TROPICAL FLAVOUR     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.36,
    "median_seconds": 3.54,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 2",
    "sku_code": "USABESPKIDSRB",
    "product_description": "US ABE SOUR PATCH KIDS 260G REDBERRY",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.05,
    "median_seconds": 4.07,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "NEUCWBAG825V",
    "product_description": "NOT FOR EU CRITICAL WHEY BAG 825G - VANILLA ICE CREAM [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 7.58,
    "median_seconds": 7.71,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PUMPABESP",
    "product_description": "ABE PUMP 500G - SLUSH PUPPIE [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.13,
    "median_seconds": 4.43,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AFBR",
    "product_description": "AMINO FUEL EAA 390G ICY BLUE RAZ     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.1,
    "median_seconds": 4.17,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PUMPABEBR",
    "product_description": "ABE PUMP 500G - BLUE RAZZ     [HS CODE:2106909285]",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 5.05,
    "median_seconds": 5.42,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "TESTOLL",
    "product_description": "TRT TESTOSTERONE HEALTH (PROFESSIONAL) 300G - LEMON & LIME     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.9,
    "median_seconds": 3.93,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AFPM",
    "product_description": "AMINO FUEL EAA 390G PINEAPPLE MILLIONS",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.54,
    "median_seconds": 3.79,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "P3GFBZERO",
    "product_description": "PUMP 3G 375g ZERO FRUIT BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.57,
    "median_seconds": 2.83,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AFCIB",
    "product_description": "AMINO FUEL EAA 390G CANDY ICE BLAST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.68,
    "median_seconds": 3.71,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "COL165TV",
    "product_description": "COLLAGEN 165G - TROPICAL VIBES     [HS CODE:2106102090]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.42,
    "median_seconds": 3.65,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BEEFXP150SR",
    "product_description": "BEEF XP 150G STRAWBERRY AND RASPBERRY     [HS CODE:2106102090]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 2.81,
    "median_seconds": 2.81,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CWBAG450C",
    "product_description": "CRITICAL WHEY BAG 450G - CHOCOLATE MILKSHAKE     [HS CODE:1806907090]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 6.08,
    "median_seconds": 6.14,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BEEFXP150LM",
    "product_description": "BEEF XP 150G LEMON & MINT [HS CODE:2106102090]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 3.26,
    "median_seconds": 3.26,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "COL150UN",
    "product_description": "COLLAGEN 150G - UNFLAVOURED     [HS CODE:2106102090]",
    "imported_current_seconds": 3.0,
    "suggested_seconds": 3.16,
    "median_seconds": 3.44,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "ABEBADB",
    "product_description": "A.B.E 375G BADDY BERRY     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.36,
    "median_seconds": 3.39,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BFHYDRATBB",
    "product_description": "BODYFUEL HYDRATION 210G - BERRY BLAST [HS CODE 2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.76,
    "median_seconds": 3.78,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "LAPERVAPOWER600BR",
    "product_description": "LAPERVA TRIPLE POWER 600G BLUE RASPBERRY - UAE",
    "imported_current_seconds": 4.5,
    "suggested_seconds": 5.25,
    "median_seconds": 5.33,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "SLEEPMB",
    "product_description": "SLEEP HEALTH 300G - MIXED BERRIES     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.35,
    "median_seconds": 3.53,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BEEFXP150BM",
    "product_description": "BEEF XP 150g - BLACKCURRANT MILLIONS  FLAVOUR     [HS CODE:2106102090]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 2.99,
    "median_seconds": 2.99,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BEEFXP150BR",
    "product_description": "BEEF XP 150G - BLUE RASPBERRY     [HS CODE:2106102090]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 2.73,
    "median_seconds": 2.88,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "NEUCOL165CT",
    "product_description": "NOT FOR EU - COLLAGEN 165G - CITRUS TWIST [HS CODE:2106102090]",
    "imported_current_seconds": 4.81,
    "suggested_seconds": 3.21,
    "median_seconds": 3.21,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CWBAG825C",
    "product_description": "CRITICAL WHEY BAG 825G - CHOCOLATE MILKSHAKE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 4.33,
    "median_seconds": 5.23,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUSHREDXGRAPE",
    "product_description": "SHRED X POWDER 340g - GRAPE - AUSTRALIA     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.36,
    "median_seconds": 4.86,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "LCAR150",
    "product_description": "ACETYL L-CARNITINE 150G     [HS CODE:2923900090]",
    "imported_current_seconds": 1.45,
    "suggested_seconds": 3.7,
    "median_seconds": 3.75,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "KSAGLUT250",
    "product_description": "GLUTAMINE POWDER 250g KSA (POWDER) IDRAJ No. P-3-N-270419-67922",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.87,
    "median_seconds": 3.87,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "HYDRO+TV",
    "product_description": "HYDRATION+ 240G TROPICAL VIBES     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.69,
    "median_seconds": 3.69,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "ABE250CC",
    "product_description": "A.B.E 250G CHERRY COLA [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.69,
    "median_seconds": 3.72,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CITMAL300",
    "product_description": "CITRULLINE MALATE 300G     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 4.09,
    "median_seconds": 4.6,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "USCREUN",
    "product_description": "US CREATINE 300G - UNFLAVOURED     [HS CODE:2925299000]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.25,
    "median_seconds": 4.25,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BETA300",
    "product_description": "BETA-ALANINE 300G     [HS CODE:2106909285]",
    "imported_current_seconds": 1.75,
    "suggested_seconds": 3.77,
    "median_seconds": 3.83,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BEEFXP150MB",
    "product_description": "BEEF XP 150G - MIXED BERRY     [HS CODE:2106102090]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 2.86,
    "median_seconds": 2.86,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BFHYDRATDS",
    "product_description": "BODYFUEL HYDRATION 210G - DRUMSTICK SQUASHIES [HS CODE - 2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.66,
    "median_seconds": 3.74,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PUMPABESPCT",
    "product_description": "ABE PUMP 500G - SLUSH PUPPIE CITRUS TWISTED",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 3.35,
    "median_seconds": 3.42,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PERUABESM",
    "product_description": "PERU ABE STRAWBERRY MOJITO 315G",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.5,
    "median_seconds": 3.59,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PERUABESG",
    "product_description": "PERU ABE SOUR GUMMY BEAR 315G",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.14,
    "median_seconds": 3.32,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PERUABECIB",
    "product_description": "PERU ABE CANDY ICE BLAST 315G",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.29,
    "median_seconds": 3.32,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUISOCLEARBC",
    "product_description": "AU ISO CLEAR 450G - BLACKCURRANT",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 6.79,
    "median_seconds": 7.1,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "LAPERVAPOWER600C",
    "product_description": "LAPERVA TRIPLE POWER 600G COLA - UAE",
    "imported_current_seconds": 4.5,
    "suggested_seconds": 4.94,
    "median_seconds": 4.94,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BFBP500CB",
    "product_description": "BODYFUEL BEEF PROTEIN 500G CITRUS BURST",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 6.98,
    "median_seconds": 7.16,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 2",
    "sku_code": "USABESPKR",
    "product_description": "USA A.B.E SOUR PATCH KIDS REDBERRY 260G",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.79,
    "median_seconds": 3.94,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "JOINTM",
    "product_description": "JOINT COMPLEX 300G - MANGO CRUSH     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.72,
    "median_seconds": 3.72,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "USABECC",
    "product_description": "US ABE CHERRY COLA FLAVOUR 390g [HS CODE: 2106909998]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.53,
    "median_seconds": 4.53,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CREPEP222",
    "product_description": "CREATINE + PEPTIDE 222G UNFLAVOURED [HS CODE:2106909285]",
    "imported_current_seconds": 3.2,
    "suggested_seconds": 4.45,
    "median_seconds": 4.45,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CW825S",
    "product_description": "CRITICAL WHEY 825G STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.41,
    "median_seconds": 6.59,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "USABERH",
    "product_description": "US ABE RED HAWAIIAN FLAVOUR 390g [HS CODE: 2106909998]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.4,
    "median_seconds": 4.4,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CREHYDB",
    "product_description": "CREATINE + HYDRATION 360G - BERRY SLUSH     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.19,
    "median_seconds": 4.27,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "COLMARCA",
    "product_description": "MARINE COLLAGEN CHERRY APPLE 300G     [HS CODE:2106102090]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.82,
    "median_seconds": 3.84,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "SLEEPBG",
    "product_description": "SLEEP HEALTH 300G - BLACK GRAPE     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.27,
    "median_seconds": 3.31,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-46",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 7.5,
    "suggested_seconds": 11.01,
    "median_seconds": 11.01,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CREHYDC",
    "product_description": "CREATINE + HYDRATION 360G - CITRUS BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.84,
    "median_seconds": 3.84,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-48",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 8.0,
    "suggested_seconds": 10.74,
    "median_seconds": 10.74,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "ISO450V",
    "product_description": "CRITICAL WHEY BAG 450G - VANILLA",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.48,
    "median_seconds": 5.64,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "SHREDXPSG",
    "product_description": "SHRED X POWDER 300G SOUR GUMMY BEAR     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.0,
    "median_seconds": 4.05,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BFPWBR320",
    "product_description": "BODYFUEL PRE-WORKOUT  BLUE RASPBERRY 320G     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.32,
    "median_seconds": 3.32,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "SHREDXPSK",
    "product_description": "SHRED X POWDER 300G STRAWBERRY KIWI     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.38,
    "median_seconds": 3.48,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "USABEAPL",
    "product_description": "US ABE SOUR APPLE FLAVOUR 390g [HS CODE: 2106909998]",
    "imported_current_seconds": 4.87,
    "suggested_seconds": 3.84,
    "median_seconds": 3.84,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "ISO450C",
    "product_description": "ISO-XP BAG 450G CHOCOLATE DESSERT",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.44,
    "median_seconds": 5.44,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "P3GFB",
    "product_description": "PUMP 3G 375g FRUIT BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.71,
    "median_seconds": 3.74,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AFCM",
    "product_description": "AMINO FUEL EAA 390G COLA MILLIONS [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.75,
    "median_seconds": 3.87,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUTRIMAGSR",
    "product_description": "AUSTRALIA TRI-MAGNESIUM 200G - STRAWBERRY RASPBERRY [HS CODE:2106909285]",
    "imported_current_seconds": 3.2,
    "suggested_seconds": 3.13,
    "median_seconds": 3.13,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "ABECC",
    "product_description": "A.B.E 375G CHERRY COLA     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.61,
    "median_seconds": 3.61,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AFFS",
    "product_description": "AMINO FUEL EAA 390G FRUIT SALAD     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.74,
    "median_seconds": 3.74,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "LABELLAPERVACARBU",
    "product_description": "LABEL LAPERVA TRIPLE CARB 1250g",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 9.75,
    "median_seconds": 10.34,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AFCL",
    "product_description": "AMINO FUEL EAA 390G CHERRY LIMEADE [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.78,
    "median_seconds": 3.78,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CLEAR450PM",
    "product_description": "CLEAR PROTEIN 450G - MILLIONS PINEAPPLE",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.87,
    "median_seconds": 5.87,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "TESTOOB",
    "product_description": "TRT TESTOSTERONE HEALTH (PROFESSIONAL)  300G - ORANGE BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.63,
    "median_seconds": 3.63,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "ABEAPL",
    "product_description": "A.B.E 375G SOUR APPLE     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.57,
    "median_seconds": 3.57,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUSHREDXLEMON",
    "product_description": "SHRED X POWDER 340g - LEMON ICE TEA - AUSTRALIA [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.63,
    "median_seconds": 3.63,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUABESV",
    "product_description": "A.B.E 375G SUMMER VIBES AU [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.44,
    "median_seconds": 3.44,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CW132V",
    "product_description": "CRITICAL WHEY 132G VANILLA",
    "imported_current_seconds": 2.8,
    "suggested_seconds": 3.19,
    "median_seconds": 3.35,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "COLHYDCITRUS",
    "product_description": "COLEEN HYDRATION CITRUS",
    "imported_current_seconds": 16.6,
    "suggested_seconds": 80.01,
    "median_seconds": 80.01,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUABESG",
    "product_description": "A.B.E 375G SOUR GUMMY BEAR AU",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.37,
    "median_seconds": 3.37,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BLENDEDCOLDEBLOATLGT",
    "product_description": "BLENDED POWDER COLEEN DEBLOAT LEMON, GINGER +TURMERIC",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 61.03,
    "median_seconds": 65.17,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PERUCRE1KG-38",
    "product_description": "CREATINE MONOHYDRATE 1KG - PERU",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 7.97,
    "median_seconds": 7.97,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUSHREDXSTRAWKIWI",
    "product_description": "SHRED X POWDER 340g - STRAWBERRY KIWI - AUSTRALIA     [HS CODE:2106909285]",
    "imported_current_seconds": 3.7,
    "suggested_seconds": 3.13,
    "median_seconds": 3.13,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PERUCRE1KG-36",
    "product_description": "CREATINE MONOHYDRATE 1KG - PERU",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 7.95,
    "median_seconds": 7.95,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUTRIMAGBR",
    "product_description": "AUSTRALIA TRI-MAGNESIUM 200G BLUE RASPBERRY [HS CODE:2106909285]",
    "imported_current_seconds": 3.2,
    "suggested_seconds": 3.29,
    "median_seconds": 3.45,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BASIXCOLLAGENPEP300",
    "product_description": "BASIX COLLAGEN PEPTIDE 300G KSA",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.19,
    "median_seconds": 4.19,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUHYDRO+SR",
    "product_description": "AUSTRALIA HYDRATION+ 240G STRAWBERRY AND RASPBERRY [HS CODE:2106909285]",
    "imported_current_seconds": 3.2,
    "suggested_seconds": 3.55,
    "median_seconds": 3.55,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BASIXCOMPLETE10WM",
    "product_description": "BASIX COMPLETE 10 EAA 405G KSA WATERMELON",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.98,
    "median_seconds": 3.98,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BASIX-THESHRED",
    "product_description": "BASIX THE SHRED SOUR GUMMY BEAR FLAVOUR 300g KSA",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.38,
    "median_seconds": 4.38,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUHYDRO+LL",
    "product_description": "AUSTRALIA HYDRATION+ 240G LEMON AND LIME [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.22,
    "median_seconds": 3.22,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AFRM",
    "product_description": "AMINO FUEL EAA 390G RASPBERRY MOJITO [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.63,
    "median_seconds": 4.63,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PERUCRE1KG-39",
    "product_description": "CREATINE MONOHYDRATE 1KG - PERU",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.1,
    "median_seconds": 6.1,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-47",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.61,
    "median_seconds": 6.61,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PERUCRE1KG-37",
    "product_description": "CREATINE MONOHYDRATE 1KG - PERU",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.33,
    "median_seconds": 6.33,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-53",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.88,
    "median_seconds": 6.88,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-44",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.98,
    "median_seconds": 7.02,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-45",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.76,
    "median_seconds": 6.76,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-49",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.44,
    "median_seconds": 6.44,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BLENDEDCOLDEBLOATPMP",
    "product_description": "BLENDED POWDER COLEEN DEBLOAT PNIEAPPLE, MINT & PRICKLY PEAR",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 82.15,
    "median_seconds": 83.96,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-54",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.58,
    "median_seconds": 6.58,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-55",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.08,
    "median_seconds": 6.08,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "USSHREDPLIT",
    "product_description": "US SHRED X EXTREME THERMOGENIC POWDER 300G (30 SERVINGS) LEMON ICED TEA     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.49,
    "median_seconds": 3.49,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PERUCRE1KG-40",
    "product_description": "CREATINE MONOHYDRATE 1KG - PERU",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.03,
    "median_seconds": 6.03,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CREHYDBR",
    "product_description": "CREATINE + HYDRATION 360G - BLUE RASPBERRY     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 4.19,
    "median_seconds": 4.19,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PERUCRE1KG-42",
    "product_description": "CREATINE MONOHYDRATE 1KG - PERU",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.17,
    "median_seconds": 6.17,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-51",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.26,
    "median_seconds": 5.26,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-52",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 7.1,
    "median_seconds": 7.1,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUISOCLEARCF",
    "product_description": "AU ISO CLEAR 450G - COLA FREEZ",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 5.65,
    "median_seconds": 5.65,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "AUSHREDXSG",
    "product_description": "SHRED X POWDER 340g - SOUR GUMMY BEAR - AUSTRALIA",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.28,
    "median_seconds": 3.28,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-43",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.61,
    "median_seconds": 5.61,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "PERUCRE1KG-41",
    "product_description": "CREATINE MONOHYDRATE 1KG - PERU",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.1,
    "median_seconds": 5.1,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "HYDRO+SR - SAMPLE",
    "product_description": "HYDRATION STRAWBERRY AND RASPBERRY  - SAMPLE",
    "imported_current_seconds": 120.0,
    "suggested_seconds": 128.05,
    "median_seconds": 128.05,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "HYDRO+BR - SAMPLE",
    "product_description": "HYDRATION BLUE RASPBERRY  - SAMPLE",
    "imported_current_seconds": 120.0,
    "suggested_seconds": 94.4,
    "median_seconds": 94.4,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "USSHREDPSGB",
    "product_description": "US SHRED X EXTREME THERMOGENIC POWDER 300G (30 SERVINGS) SOUR GUMMY BEAR     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.9,
    "median_seconds": 2.9,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "SAMPLE BAGS",
    "product_description": "BODYFUEL HYDRATION DRUMSTICK SQUASHIES",
    "imported_current_seconds": 120.0,
    "suggested_seconds": 4.24,
    "median_seconds": 4.24,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "CRE1KG-50",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 4.65,
    "median_seconds": 4.65,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BEEFXP150CT",
    "product_description": "BEEF XP 150G CITRUS TWIST     [HS CODE:2106102090]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 3.11,
    "median_seconds": 3.11,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "NEUCOL150UN",
    "product_description": "NOT FOR EU COLLAGEN 150G - UNFLAVOURED [HS CODE:2106102090]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BLENDEDCOLSLEEPLH",
    "product_description": "BLENDED POWDER COLEEN SLEEP LEMON & HONEY",
    "imported_current_seconds": 16.6,
    "suggested_seconds": 73.9,
    "median_seconds": 73.9,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 2",
    "sku_code": "SAMPLE - HYD + TV",
    "product_description": "SAMPLE BAGS HYDRATION+ TROPICAL VIBES",
    "imported_current_seconds": 120.0,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 2",
    "sku_code": "SAMPLE - HYD+LL",
    "product_description": "SAMPLE BAGS HYDRATION + LEMON AND LIME",
    "imported_current_seconds": 120.0,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BLENDEDCOLIMMUNBOG",
    "product_description": "BLENDED POWDER COLEEN IMMUNITY BLOOD ORANGE & GRAPEFRUIT",
    "imported_current_seconds": 1.0,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 2",
    "sku_code": "BLENDEDCOLIMMUNBR",
    "product_description": "BLENDED POWDER COLEEN IMMUNITY BLUEBERRY & RASPBERRY",
    "imported_current_seconds": 1.0,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COLPEP",
    "product_description": "COLLAGEN PEPTIDES 300G     [HS CODE:2106102090]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.36,
    "median_seconds": 3.56,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COLMAR",
    "product_description": "MARINE COLLAGEN  300G     [HS CODE:2106102090]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.69,
    "median_seconds": 3.76,
    "sample_shifts": 9
  },
  {
    "machine_name": "Line 3",
    "sku_code": "DW1V",
    "product_description": "DIET WHEY 1KG VANILLA CREAM     [HS CODE:2106108070]",
    "imported_current_seconds": 6.12,
    "suggested_seconds": 6.27,
    "median_seconds": 7.35,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 3",
    "sku_code": "ISO18C",
    "product_description": "ISO-XP 1.8KG CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 6.27,
    "median_seconds": 7.01,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CRE1KG",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.0,
    "median_seconds": 6.0,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 3",
    "sku_code": "HYDRO+SR",
    "product_description": "HYDRATION+ 240G STRAWBERRY AND RASPBERRY     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.41,
    "median_seconds": 3.57,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP16V",
    "product_description": "ESSENTIAL PROTEIN 1.6KG VANILLA ICE CREAM  [HS CODE:2106108079]",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 6.1,
    "median_seconds": 7.05,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 3",
    "sku_code": "MMWPC",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900G - CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.2,
    "median_seconds": 5.86,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUBFWP900DC",
    "product_description": "NOT FOR EU - BODYFUEL WHEY PROTEIN 900G DOUBLE CHOCOLATE",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.19,
    "median_seconds": 5.52,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 3",
    "sku_code": "PERUCRE1KG",
    "product_description": "CREATINE MONOHYDRATE 1KG - PERU",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.06,
    "median_seconds": 6.34,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 3",
    "sku_code": "DW18C",
    "product_description": "DIET WHEY 1.8KG CHOCOLATE DESSERT     [HS CODE:1806907090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 6.9,
    "median_seconds": 7.6,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMC24",
    "product_description": "CRITICAL MASS 2.4KG CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.97,
    "median_seconds": 8.42,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMV24",
    "product_description": "CRITICAL MASS 2.4KG VANILLA     [HS CODE:2106108031]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.59,
    "median_seconds": 7.17,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 3",
    "sku_code": "ISO18V",
    "product_description": "ISO-XP 1.8KG VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 8.85,
    "median_seconds": 10.31,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUMMMG2V",
    "product_description": "NOT FOR EU MUSCLE MOOSE MASS GAINER 2KG BAG - VANILLA",
    "imported_current_seconds": 9.7,
    "suggested_seconds": 6.9,
    "median_seconds": 8.29,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COR1RR",
    "product_description": "CREAM OF RICE 1KG RASPBERRY RIPPLE     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.94,
    "median_seconds": 6.78,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 3",
    "sku_code": "HYDRO+TV",
    "product_description": "HYDRATION+ 240G TROPICAL VIBES     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.7,
    "median_seconds": 3.85,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP16CNC",
    "product_description": "ESSENTIAL PROTEIN 1.6KG COOKIES N CREAM  [HS CODE:2106108079]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 6.12,
    "median_seconds": 7.27,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP16S",
    "product_description": "ESSENTIAL PROTEIN 1.6KG STRAWBERRY MILKSHAKE  [HS CODE:2106108079]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 6.98,
    "median_seconds": 7.23,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CORGS",
    "product_description": "CREAM OF RICE  2KG GOLDEN SYRUP",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.94,
    "median_seconds": 8.17,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 3",
    "sku_code": "ISO18B",
    "product_description": "ISO-XP 1.8KG BANANA     [HS CODE:2106108070]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 8.73,
    "median_seconds": 9.57,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 3",
    "sku_code": "DWBAG450C",
    "product_description": "DIET WHEY (BAG) 450G CHOCOLATE DESSERT     [HS CODE:1806205090]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.08,
    "median_seconds": 6.22,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CARBU",
    "product_description": "CARB X 1.2KG - UNFLAVOURED     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 7.15,
    "median_seconds": 7.41,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 3",
    "sku_code": "ISO18S",
    "product_description": "ISO-XP 1.8KG STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 8.43,
    "median_seconds": 8.71,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUBFWP900V",
    "product_description": "NOT FOR EU - BODYFUEL WHEY PROTEIN 900G VANILLA MILKSHAKE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 4.81,
    "median_seconds": 5.4,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUDWBAG450V",
    "product_description": "NOT FOR EU - DIET WHEY (BAG) 450G VANILLA CREAM [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.9,
    "median_seconds": 5.95,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "DW18V",
    "product_description": "DIET WHEY 1.8KG VANILLA CREAM     [HS CODE:2106108070]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 6.79,
    "median_seconds": 7.12,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFWP18V",
    "product_description": "BODYFUEL WHEY PROTEIN 1.8KG VANILLA",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 9.48,
    "median_seconds": 10.56,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CREHYDUN",
    "product_description": "CREATINE + HYDRATION 330G - UNFLAVOURED     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.56,
    "median_seconds": 3.68,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CREHYDBR",
    "product_description": "CREATINE + HYDRATION 360G - BLUE RASPBERRY     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.83,
    "median_seconds": 3.83,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COLMARSR",
    "product_description": "MARINE COLLAGEN STRAWBERRY RASPBERRY 300G     [HS CODE:2106102090]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.56,
    "median_seconds": 3.68,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFWP900DC",
    "product_description": "BODYFUEL WHEY PROTEIN 900G DOUBLE CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 6.7,
    "median_seconds": 8.16,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "TESTOOB",
    "product_description": "TESTOSTERONE (TRT) ORANGE BURST 300G",
    "imported_current_seconds": 3.2,
    "suggested_seconds": 3.81,
    "median_seconds": 3.83,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMV6",
    "product_description": "CRITICAL MASS 6KG  VANILLA     [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 8.12,
    "median_seconds": 8.55,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COR1AC",
    "product_description": "CREAM OF RICE 1KG APPLE CRUMBLE     [HS CODE:2106909285]",
    "imported_current_seconds": 8.25,
    "suggested_seconds": 4.88,
    "median_seconds": 5.41,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CARBFB",
    "product_description": "CARB X 1.2KG - FRUIT BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 7.3,
    "median_seconds": 7.97,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFHYDRATOC",
    "product_description": "BODYFUEL HYDRATION 210G - ORANGE CRUSH      [HS CODE - 2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.9,
    "median_seconds": 3.96,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "MMWPS",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900G - STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 4.87,
    "median_seconds": 5.99,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "GLUT250",
    "product_description": "GLUTAMINE POWDER 250g     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.47,
    "median_seconds": 4.49,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CARBO",
    "product_description": "CARB X 1.2KG - ORANGE BURST [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.66,
    "median_seconds": 7.0,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUMMWPV",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900G - VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 8.22,
    "median_seconds": 8.87,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "HYDRO+LL",
    "product_description": "HYDRATION+ 240G LEMON AND LIME     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.77,
    "median_seconds": 3.86,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "MMWPWCHZ",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900g - WHITE CHOCOLATE HAZELNUT [HS CODE:2106108079]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.94,
    "median_seconds": 6.09,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUBFWP900WCP",
    "product_description": "NOT FOR EU - BODYFUEL WHEY PROTEIN 900G WHITE CHOCOLATE PISTACHIO",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.44,
    "median_seconds": 6.71,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "DW1S",
    "product_description": "DIET WHEY 1KG STRAWBERRY MILKSHAKE     [HS CODE:2106108070]",
    "imported_current_seconds": 5.62,
    "suggested_seconds": 6.84,
    "median_seconds": 7.49,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COR1GS",
    "product_description": "CREAM OF RICE BAG 1KG GOLDEN SYRUP",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.04,
    "median_seconds": 5.23,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "AUHYDRO+BR",
    "product_description": "AUSTRALIA HYDRATION+ 240G BLUE RASPBERRY [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.99,
    "median_seconds": 4.02,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFHYDRATLL",
    "product_description": "BODYFUEL HYDRATION 210G - LEMON & LIME      [HS CODE - 2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.39,
    "median_seconds": 3.56,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CP18V",
    "product_description": "CRITICAL PLANT PROTEIN 1.8KG VANILLA      [HS CODE:2106102090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 10.4,
    "median_seconds": 12.25,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "TRIMAGSR",
    "product_description": "TRI-MAGNESIUM 200G - STRAWBERRY RASPBERRY     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 3.25,
    "median_seconds": 3.27,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFHYDRATDS",
    "product_description": "BODYFUEL HYDRATION 210G - DRUMSTICK SQUASHIES [HS CODE - 2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.4,
    "median_seconds": 3.52,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CORAC",
    "product_description": "CREAM OF RICE 2KG APPLE CRUMBLE     [HS CODE:2106909285]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.97,
    "median_seconds": 8.13,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFWP900V",
    "product_description": "BODYFUEL WHEY PROTEIN 900G VANILLA MILKSHAKE     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.46,
    "median_seconds": 5.84,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CORUN",
    "product_description": "CREAM OF RICE BAG 1KG",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 5.73,
    "median_seconds": 6.36,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "DW1C",
    "product_description": "DIET WHEY 1KG CHOCOLATE DESSERT     [HS CODE:1806907090]",
    "imported_current_seconds": 6.75,
    "suggested_seconds": 7.96,
    "median_seconds": 8.17,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUDWBAG450S",
    "product_description": "NOT FOR EU - DIET WHEY (BAG) 450G STRAWBERRY MILKSHAKE [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.36,
    "median_seconds": 5.54,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "RECOENDUCHOC",
    "product_description": "ENDURANCE  RECOVERY 1.5Kg - CHOCOLATE     [HS CODE:1806209519]",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 6.98,
    "median_seconds": 7.98,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "DW18S",
    "product_description": "DIET WHEY 1.8KG STRAWBERRY MILKSHAKE     [HS CODE:2106108070]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 7.96,
    "median_seconds": 8.18,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "TAUR200",
    "product_description": "TAURINE 200G     [HS CODE:2106909285]",
    "imported_current_seconds": 3.25,
    "suggested_seconds": 3.55,
    "median_seconds": 3.55,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COR2U",
    "product_description": "CREAM OF RICE UNFLAVOURED 2KG",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 8.65,
    "median_seconds": 8.83,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP16IS",
    "product_description": "ESSENTIAL PROTEIN 1.6KG IBIZA SUNSET  [HS CODE:2106108079]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 6.11,
    "median_seconds": 6.38,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 3",
    "sku_code": "ISO850BUENO",
    "product_description": "ISO-XP 850G - CHOCO HAZELNUT",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 7.82,
    "median_seconds": 7.86,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CREPEP",
    "product_description": "CREATINE + PEPTIDE 444G UNFLAVOURED     [HS CODE:2106909285]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 6.28,
    "median_seconds": 6.28,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "MMWPCOOKIE",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900G - COOKIES AND CREAM     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.5,
    "median_seconds": 5.55,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "RECOENDUSTRAW",
    "product_description": "ENDURANCE  RECOVERY 1.5Kg - STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 7.07,
    "median_seconds": 8.17,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "ISO850V",
    "product_description": "ISO-XP 850G - VANILLA [HS CODE:2106108079]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.24,
    "median_seconds": 6.82,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFMG6S",
    "product_description": "BODYFUEL MASS GAINER 6KG  - STRAWBERRY",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 7.71,
    "median_seconds": 9.52,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "KSACORRR",
    "product_description": "CREAM OF RICE RASPBERRY RIPPLE 2KG KSA (POWDER) IDRAJ No",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 8.58,
    "median_seconds": 9.09,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CREPEP222",
    "product_description": "CREATINE + PEPTIDE 222G UNFLAVOURED [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.19,
    "median_seconds": 3.19,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUMMWPCOOKIE",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900G - COOKIES AND CREAM     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.68,
    "median_seconds": 6.17,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP400PC",
    "product_description": "ESSENTIAL PROTEIN 400G PEACHES & CREAM",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 6.48,
    "median_seconds": 6.66,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CARBBM",
    "product_description": "CARB X 1.2KG - BLACKCURRANT MILLIONS [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.64,
    "median_seconds": 6.87,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMWC24",
    "product_description": "CRITICAL MASS 2.4KG WHITE CHOCOLATE RASPBERRY     [HS CODE:2106108031]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 9.55,
    "median_seconds": 10.75,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COMPBREAKAC",
    "product_description": "COMPLETE BREAKFAST SMOOTHIE - APPLE & CINNAMON 490G BAG (14 SERVINGS)",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 6.19,
    "median_seconds": 6.29,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BLENDEDCOLMARS",
    "product_description": "BLENDED POWDER COLEEN MARINE COLLAGEN STRAWBERRY",
    "imported_current_seconds": 16.6,
    "suggested_seconds": 69.54,
    "median_seconds": 69.54,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP400WCC",
    "product_description": "ESSENTIAL PROTEIN WHITE CHOCOLATE COCONUT 400G",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 5.81,
    "median_seconds": 6.06,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "DW1B",
    "product_description": "DIET WHEY 1KG BANANA MILKSHAKE     [HS CODE:2106108070]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 7.06,
    "median_seconds": 7.06,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFWP18DC",
    "product_description": "BODYFUEL WHEY PROTEIN 1.8KG DOUBLE CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 11.02,
    "median_seconds": 11.56,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CP18S",
    "product_description": "CRITICAL PLANT PROTEIN 1.8KG STRAWBERRY [HS CODE:2106108071]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 11.22,
    "median_seconds": 11.22,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COMPPBAG450V",
    "product_description": "COMPLETE PROTEIN BAG 450G - VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 5.79,
    "median_seconds": 5.79,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFWP18S",
    "product_description": "BODYFUEL WHEY PROTEIN 1.8KG STRAWBERRY ICE CREAM     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 11.51,
    "median_seconds": 11.61,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "ISO850S",
    "product_description": "ISO-XP 850G - STRAWBERRY [HS CODE:2106108079]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 7.88,
    "median_seconds": 7.88,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COLMARCA",
    "product_description": "MARINE COLLAGEN CHERRY APPLE 300G     [HS CODE:2106102090]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 3.6,
    "median_seconds": 3.6,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "MMMG2V",
    "product_description": "MUSCLE MOOSE MASS GAINER 2KG BAG - VANILLA",
    "imported_current_seconds": 8.49,
    "suggested_seconds": 5.76,
    "median_seconds": 6.94,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CP18C",
    "product_description": "CRITICAL PLANT PROTEIN 1.8KG CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 8.58,
    "median_seconds": 9.7,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "TRIMAGLL",
    "product_description": "TRI-MAGNESIUM 200G - LEMON AND LIME     [HS CODE:2106909285]",
    "imported_current_seconds": 3.25,
    "suggested_seconds": 4.05,
    "median_seconds": 4.05,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUDWBAG450SC",
    "product_description": "NOT FOR EU - DIET WHEY (BAG) 450G SALTED CARAMEL [HS CODE:2106108070]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 6.16,
    "median_seconds": 6.16,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "DWBAG450SC",
    "product_description": "NOT FOR EU - DIET WHEY (BAG) 450G SALTED CARAMEL [HS CODE:2106108070]",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 5.46,
    "median_seconds": 5.46,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMS24",
    "product_description": "CRITICAL MASS 2.4KG STRAWBERRY     [HS CODE:2106108031]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 8.37,
    "median_seconds": 8.38,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COMPBREAKBB",
    "product_description": "COMPLETE BREAKFAST SMOOTHIE - BANANA & BERRIES 490G BAG (14 SERVINGS)",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 5.71,
    "median_seconds": 5.71,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "DW18B",
    "product_description": "DIET WHEY 1.8KG BANANA MILKSHAKE     [HS CODE:2106108070]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 8.46,
    "median_seconds": 8.84,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUMMWPWCHZ",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900g - WHITE CHOCOLATE HAZELNUT  [HS CODE:1806907090]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 9.58,
    "median_seconds": 9.58,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "TRIMAGTV",
    "product_description": "TRI-MAGNESIUM 200G - TROPICAL VIBES     [HS CODE:2106909285]",
    "imported_current_seconds": 3.25,
    "suggested_seconds": 3.79,
    "median_seconds": 3.79,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "ISO1PEANUT",
    "product_description": "ISO-XP 1KG - CHOCO PEANUT     [HS CODE:1806907090]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.89,
    "median_seconds": 6.89,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP400WCNC",
    "product_description": "ESSENTIAL PROTEIN COOKIES N CREAM 400G",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 6.35,
    "median_seconds": 6.35,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "RECOENDUVAN",
    "product_description": "ENDURANCE  RECOVERY 1.5Kg - VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.5,
    "suggested_seconds": 6.08,
    "median_seconds": 6.17,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP800IS",
    "product_description": "ESSENTIAL PROTEIN 800G IBIZA SUNSET",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.83,
    "median_seconds": 5.83,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CRE1KG-25",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 7.42,
    "median_seconds": 7.42,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CW825WBUENO",
    "product_description": "CRITICAL WHEY 825G WHITE CHOCOLATE HAZELNUT (BUENO)     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 13.04,
    "median_seconds": 13.04,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CRE1KG-28",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.62,
    "median_seconds": 6.62,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CRE1KG-29",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.46,
    "median_seconds": 6.46,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "COMPBREAKCM",
    "product_description": "COMPLETE BREAKFAST SMOOTHIE - COCONUT & MANGO 490G BAG (14 SERVINGS)",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 5.27,
    "median_seconds": 5.27,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "ISO850CARAMEL",
    "product_description": "ISO-XP 850G - CHOCO CARAMEL [HS CODE:2106108079]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 7.0,
    "median_seconds": 7.0,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFWP18WCP",
    "product_description": "BODYFUEL WHEY PROTEIN 1.8KG WHITE CHOCOLATE PISTACHIO",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 10.91,
    "median_seconds": 10.91,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP400V",
    "product_description": "ESSENTIAL PROTEIN VANILLA  ICE CREAM 400G",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 5.04,
    "median_seconds": 5.04,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CW825S 16",
    "product_description": "CRITICAL WHEY 825G STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 7.32,
    "median_seconds": 7.32,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP400CB",
    "product_description": "ESSENTIAL PROTEIN 400G CARAMEL BISCUIT",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 6.19,
    "median_seconds": 6.19,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP800CNC",
    "product_description": "ESSENTIAL PROTEIN COOKIES N CREAM 800G",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.47,
    "median_seconds": 6.47,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFMG6WCP",
    "product_description": "BODYFUEL MASS GAINER 6KG  - WHITE CHOC PISTACHIO",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 9.04,
    "median_seconds": 9.04,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CW825FRAP",
    "product_description": "CRITICAL WHEY 825G FRAPPUCCINO     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 7.52,
    "median_seconds": 7.52,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMC6 -13",
    "product_description": "CRITICAL MASS 6KG  CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 20.0,
    "median_seconds": 20.0,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "KSACORGS",
    "product_description": "CREAM OF RICE 2KG GOLDEN SYRUP KSA (POWDER) IDRAJ No. P-3-N-210722-112731",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 8.96,
    "median_seconds": 8.96,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP800V",
    "product_description": "ESSENTIAL PROTEIN VANILLA  ICE CREAM 800G",
    "imported_current_seconds": 5.38,
    "suggested_seconds": 7.56,
    "median_seconds": 7.56,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFMG6V",
    "product_description": "BODYFUEL MASS GAINER 6KG  - VANILLA",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 8.85,
    "median_seconds": 8.85,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CW825S 19",
    "product_description": "CRITICAL WHEY 825G STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.97,
    "median_seconds": 6.97,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CRE1KG-27",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.74,
    "median_seconds": 5.74,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "MMWPDC",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900G - DUBAI CHOCOLATE [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.28,
    "median_seconds": 5.28,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CRE1KG-26",
    "product_description": "CREATINE MONOHYDRATE 1KG     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.48,
    "median_seconds": 5.48,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CW825S 18",
    "product_description": "CRITICAL WHEY 825G STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 7.15,
    "median_seconds": 7.15,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP450S",
    "product_description": "ESSENTIAL PROTEIN STRAWBERRY 400G",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.11,
    "median_seconds": 7.11,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BLENDEDCOLMARC",
    "product_description": "BLENDED POWDER COLEEN MARINE COLLAGEN CITRUS",
    "imported_current_seconds": 16.6,
    "suggested_seconds": 66.71,
    "median_seconds": 66.71,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CW825B",
    "product_description": "CRITICAL WHEY 825G BANANA     [HS CODE:2106108070]B",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.73,
    "median_seconds": 5.73,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP800CB",
    "product_description": "ESSENTIAL PROTEIN 800G  CARAMEL BISCUIT",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.94,
    "median_seconds": 6.94,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP400SC",
    "product_description": "ESSENTIAL PROTEIN 400G SALTED CARAMEL",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 4.99,
    "median_seconds": 4.99,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUMMMG2C",
    "product_description": "(NEU)MUSCLE MOOSE MASS GAINER 2KG BAG - CHOCOLATE",
    "imported_current_seconds": 9.7,
    "suggested_seconds": 7.75,
    "median_seconds": 7.75,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CW825S 17",
    "product_description": "CRITICAL WHEY 825G STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.23,
    "median_seconds": 6.23,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "MMMG2C",
    "product_description": "MUSCLE MOOSE MASS GAINER 2KG BAG - CHOCOLATE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 7.87,
    "median_seconds": 7.87,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CORTB",
    "product_description": "CREAM OF RICE 2KG TOFFEE BISCUIT     [HS CODE:2106909285]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 8.54,
    "median_seconds": 8.54,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "NEUMMWPCHZ",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900g - CHOCOLATE HAZELNUT FLAVOUR      [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 4.93,
    "median_seconds": 4.93,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP800SC",
    "product_description": "ESSENTIAL PROTEIN 800G SALTED CARAMEL",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.15,
    "median_seconds": 6.15,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMC6 -12",
    "product_description": "CRITICAL MASS 6KG  CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 12.66,
    "median_seconds": 12.66,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP800PC",
    "product_description": "ESSENTIAL PROTEIN 800G PEACHES & CREAM",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.93,
    "median_seconds": 5.93,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "USAUTRIMAGBR",
    "product_description": "AUSTRALIA TRI-MAGNESIUM 200G BLUE RASPBERRY [HS CODE:2106909285]",
    "imported_current_seconds": 3.25,
    "suggested_seconds": 4.28,
    "median_seconds": 4.28,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CRE250",
    "product_description": "CREATINE MONOHYDRATE POWDER 250g [HS CODE: 2106909285]",
    "imported_current_seconds": 3.2,
    "suggested_seconds": 2.5,
    "median_seconds": 2.5,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMC6 -14",
    "product_description": "CRITICAL MASS 6KG  CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 14.51,
    "median_seconds": 14.51,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "EP400S",
    "product_description": "BODYFUEL WHEY PROTEIN 900G STRAWBERRY ICE CREAM     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.2,
    "median_seconds": 5.2,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMC6 -11",
    "product_description": "CRITICAL MASS 6KG  CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 12.57,
    "median_seconds": 12.57,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "BFMG6C",
    "product_description": "BODYFUEL MASS GAINER 6KG  - CHOCOLATE",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 7.62,
    "median_seconds": 7.62,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMC6",
    "product_description": "CRITICAL MASS 6KG  CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 6.24,
    "median_seconds": 6.24,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 3",
    "sku_code": "CMC6 -10",
    "product_description": "CRITICAL MASS 6KG  CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 4",
    "sku_code": "CRE250",
    "product_description": "CREATINE MONOHYDRATE POWDER 250g     [HS CODE: 2106909285]",
    "imported_current_seconds": 2.3,
    "suggested_seconds": 2.08,
    "median_seconds": 2.28,
    "sample_shifts": 108
  },
  {
    "machine_name": "Line 4",
    "sku_code": "CRE500",
    "product_description": "CREATINE MONOHYDRATE POWDER 500g     [HS CODE: 2106909285]",
    "imported_current_seconds": 3.25,
    "suggested_seconds": 2.32,
    "median_seconds": 2.53,
    "sample_shifts": 49
  },
  {
    "machine_name": "Line 4",
    "sku_code": "CRE250SR",
    "product_description": "CREATINE 250G - STRAWBERRY AND RASPBERRY     [HS CODE:2106909285]",
    "imported_current_seconds": 2.3,
    "suggested_seconds": 2.1,
    "median_seconds": 2.32,
    "sample_shifts": 15
  },
  {
    "machine_name": "Line 4",
    "sku_code": "CRE250BR",
    "product_description": "CREATINE 250G - BLUE RASPBERRY     [HS CODE:2106909285]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 2.24,
    "median_seconds": 2.4,
    "sample_shifts": 15
  },
  {
    "machine_name": "Line 4",
    "sku_code": "PERUCRE250",
    "product_description": "CREATINE MONOHYDRATE 250G - PERU",
    "imported_current_seconds": 2.1,
    "suggested_seconds": 2.19,
    "median_seconds": 2.35,
    "sample_shifts": 12
  },
  {
    "machine_name": "Line 4",
    "sku_code": "BFCREATINEUF300",
    "product_description": "BODYFUEL CREATINE UNFLAVOURED 300G     [HS CODE:2106909285]",
    "imported_current_seconds": 2.3,
    "suggested_seconds": 2.22,
    "median_seconds": 2.37,
    "sample_shifts": 12
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABEBR",
    "product_description": "A.B.E 375G ICY BLUE RAZ     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.6,
    "median_seconds": 2.84,
    "sample_shifts": 13
  },
  {
    "machine_name": "Line 4",
    "sku_code": "CRE250CA",
    "product_description": "CREATINE 250G - CHERRY AND APPLE     [HS CODE:2106909285]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 2.25,
    "median_seconds": 2.33,
    "sample_shifts": 11
  },
  {
    "machine_name": "Line 4",
    "sku_code": "BFCREATINEBR300",
    "product_description": "BODYFUEL CREATINE BLUE RASPBERRY 300G [HS CODE:2106909285]",
    "imported_current_seconds": 2.1,
    "suggested_seconds": 2.11,
    "median_seconds": 2.33,
    "sample_shifts": 12
  },
  {
    "machine_name": "Line 4",
    "sku_code": "BFCREATINESR300",
    "product_description": "BODYFUEL CREATINE STRAWBERRY RASPBERRY 300G     [HS CODE:2106909285]",
    "imported_current_seconds": 2.1,
    "suggested_seconds": 2.44,
    "median_seconds": 2.58,
    "sample_shifts": 9
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABECIB",
    "product_description": "A.B.E 375G CANDY ICE BLAST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.34,
    "median_seconds": 2.54,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 4",
    "sku_code": "BFPWBR320",
    "product_description": "BODYFUEL PRE-WORKOUT  BLUE RASPBERRY 320G     [HS CODE:2106909285]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 2.34,
    "median_seconds": 2.73,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 4",
    "sku_code": "BFCREATINELH300",
    "product_description": "BODYFUEL CREATINE LOVE HEARTS 300G [HS CODE:2106909285]",
    "imported_current_seconds": 2.5,
    "suggested_seconds": 2.59,
    "median_seconds": 2.77,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 4",
    "sku_code": "CREAPURE250",
    "product_description": "CREAPURE 250G [HS CODE: 2106909285]",
    "imported_current_seconds": 3.25,
    "suggested_seconds": 2.57,
    "median_seconds": 2.64,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 4",
    "sku_code": "PERUCRE500",
    "product_description": "CREATINE MONOHYDRATE 500G - PERU",
    "imported_current_seconds": 3.25,
    "suggested_seconds": 2.57,
    "median_seconds": 2.73,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABESP",
    "product_description": "A.B.E 375G SLUSH PUPPIE     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.08,
    "median_seconds": 2.3,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 4",
    "sku_code": "BFPWWS320",
    "product_description": "BODYFUEL PRE-WORKOUT WATERMELON SPLASH 320G [HS CODE:2106909285]",
    "imported_current_seconds": 2.7,
    "suggested_seconds": 2.11,
    "median_seconds": 2.15,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 4",
    "sku_code": "KSACRE250",
    "product_description": "CREATINE MONOHYDRATE 250g - KSA (POWDER) IDRAJ No. P-3-N-270419-67920",
    "imported_current_seconds": 2.3,
    "suggested_seconds": 1.99,
    "median_seconds": 2.11,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABESPTC",
    "product_description": "A.B.E 375G SLUSH PUPPIE - TWISTED CITRUS",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 1.86,
    "median_seconds": 1.95,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABE250BR",
    "product_description": "A.B.E 250G ICY BLUE RAZ [HS CODE:2106909285]",
    "imported_current_seconds": 2.2,
    "suggested_seconds": 3.79,
    "median_seconds": 3.79,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABEWM",
    "product_description": "A.B.E 375G WATERMELON    [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.74,
    "median_seconds": 2.76,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABEAPL",
    "product_description": "A.B.E 375G SOUR APPLE     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.5,
    "median_seconds": 2.7,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABEWH",
    "product_description": "A.B.E 375G WHITE",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.33,
    "median_seconds": 2.59,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABEBADB",
    "product_description": "A.B.E 375G BADDY BERRY     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.41,
    "median_seconds": 2.58,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABETROP",
    "product_description": "A.B.E 375G TROPICAL FLAVOUR     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.29,
    "median_seconds": 2.6,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABEBB",
    "product_description": "A.B.E 375G BUBBLEGUM CRUSH     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.45,
    "median_seconds": 2.52,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABEENG",
    "product_description": "A.B.E 375G ENERGY     [HS CODE:2106909285]",
    "imported_current_seconds": 2.6,
    "suggested_seconds": 2.41,
    "median_seconds": 2.41,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 4",
    "sku_code": "USCREBR",
    "product_description": "US CREATINE 300G - BLUE RAZZ     [HS CODE:2925299000]",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 2.38,
    "median_seconds": 2.45,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 4",
    "sku_code": "USCRESPKREDBERRY",
    "product_description": "US CREATINE SOUR PATCH KIDS RED BERRY 240G",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 2.67,
    "median_seconds": 2.67,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "FRCREAPURE250",
    "product_description": "FRANCE CREAPURE 250G [HS CODE: 2106909285]",
    "imported_current_seconds": 2.1,
    "suggested_seconds": 2.91,
    "median_seconds": 2.91,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABEFP",
    "product_description": "A.B.E 375G FRUIT PUNCH     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.05,
    "median_seconds": 2.08,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 4",
    "sku_code": "CRE250PAKISTAN",
    "product_description": "CREATINE MONOHYDRATE 250g MOROCCO    [HS CODE:2106909285]",
    "imported_current_seconds": 2.1,
    "suggested_seconds": 2.54,
    "median_seconds": 2.54,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "AUCRE250SR",
    "product_description": "AUSTRALIA CREATINE 250G - STRAWBERRY AND RASPBERRY",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 2.5,
    "median_seconds": 2.54,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 4",
    "sku_code": "PUMPABEBR",
    "product_description": "ABE PUMP 500G - BLUE RAZZ     [HS CODE:2106909285]",
    "imported_current_seconds": 3.25,
    "suggested_seconds": 4.17,
    "median_seconds": 4.49,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 4",
    "sku_code": "AUSCRE250",
    "product_description": "CREATINE MONOHYDRATE POWDER 250g     [HS CODE: 2106909285] AUSTRALIA",
    "imported_current_seconds": 2.3,
    "suggested_seconds": 2.01,
    "median_seconds": 2.01,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABESM",
    "product_description": "A.B.E 375G STRAWBERRY MOJITO     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.6,
    "median_seconds": 2.6,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "P3GU",
    "product_description": "PUMP 3G 375g UNICORN FLAVOUR     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.77,
    "median_seconds": 2.77,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABECC",
    "product_description": "A.B.E 375G CHERRY COLA     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.43,
    "median_seconds": 2.43,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "UAEABECIB",
    "product_description": "UAE A.B.E 375G CANDY ICE BLAST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.6,
    "median_seconds": 2.6,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "P3GFB",
    "product_description": "PUMP 3G 375g FRUIT BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.38,
    "median_seconds": 2.38,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "BASIXPUMPCOLA",
    "product_description": "BASIX XTREME PUMP COLA 330G - KSA",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.98,
    "median_seconds": 2.98,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "ABESG",
    "product_description": "A.B.E 375G SOUR GUMMY BEAR     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.25,
    "median_seconds": 2.25,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "PUMPABESP",
    "product_description": "ABE PUMP 500G - SLUSH PUPPIE [HS CODE:2106909285]",
    "imported_current_seconds": 3.25,
    "suggested_seconds": 2.67,
    "median_seconds": 2.67,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 4",
    "sku_code": "USCRESPKBR240",
    "product_description": "USA CREATINE MONOHYDRATE SOUR PATCH KIDS BLUE RASPBERRY 240G",
    "imported_current_seconds": 2.2,
    "suggested_seconds": 2.39,
    "median_seconds": 2.39,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2V",
    "product_description": "CRITICAL WHEY 2KG VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.79,
    "median_seconds": 8.92,
    "sample_shifts": 26
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2C",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.48,
    "median_seconds": 8.76,
    "sample_shifts": 18
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPPM",
    "product_description": "BEEF-XP 1.8kg PINEAPPLE MILLIONS FLAVOUR [HS CODE:2106102090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.14,
    "median_seconds": 6.71,
    "sample_shifts": 14
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2BUENO",
    "product_description": "CRITICAL WHEY 2KG CHOCO HAZELNUT (BUENO)     [HS CODE:1806907090]",
    "imported_current_seconds": 6.0,
    "suggested_seconds": 7.86,
    "median_seconds": 9.22,
    "sample_shifts": 12
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2S",
    "product_description": "CRITICAL WHEY 2KG STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 8.48,
    "median_seconds": 9.04,
    "sample_shifts": 12
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPBM",
    "product_description": "BEEF-XP 1.8kg BLACKCURRANT MILLIONS FLAVOUR     [HS CODE:2106102090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 6.51,
    "median_seconds": 7.19,
    "sample_shifts": 11
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPMB",
    "product_description": "BEEF-XP 1.8KG MIXED BERRY     [HS CODE:2106102090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 6.4,
    "median_seconds": 7.23,
    "sample_shifts": 11
  },
  {
    "machine_name": "Line 5",
    "sku_code": "MMWPCHZ",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900g - CHOCOLATE HAZELNUT FLAVOUR      [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.43,
    "median_seconds": 6.4,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2CNC",
    "product_description": "CRITICAL WHEY 2KG COOKIES N CREAM     [HS CODE:1806907090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 8.0,
    "median_seconds": 10.04,
    "sample_shifts": 10
  },
  {
    "machine_name": "Line 5",
    "sku_code": "NEUMMWPCHZ",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900g - CHOCOLATE HAZELNUT FLAVOUR      [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 6.03,
    "median_seconds": 6.93,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2WCP",
    "product_description": "CRITICAL WHEY 2KG WHITE CHOC PISTACHIO     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.12,
    "median_seconds": 8.81,
    "sample_shifts": 9
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW825C",
    "product_description": "CRITICAL WHEY 825G CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.52,
    "median_seconds": 5.85,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 5",
    "sku_code": "MMMG2V",
    "product_description": "MUSCLE MOOSE MASS GAINER 2KG BAG - VANILLA",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.28,
    "median_seconds": 8.11,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2BS",
    "product_description": "CRITICAL WHEY 2KG CHIQUITA BANANA STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.28,
    "median_seconds": 7.84,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPBLUERAS",
    "product_description": "BEEF-XP 1.8KG BLUE RASPBERRY     [HS CODE:2106102090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 8.12,
    "median_seconds": 9.06,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2SC",
    "product_description": "CRITICAL WHEY 2KG SALTED CARAMEL     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.77,
    "median_seconds": 8.61,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2CL",
    "product_description": "CRITICAL WHEY 2KG CARAMEL LATTE     [HS CODE:2106108070]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 10.62,
    "median_seconds": 11.97,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPTV",
    "product_description": "BEEF-XP 1.8KG TROPICAL VIBES   [HS CODE:2106102090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 7.97,
    "median_seconds": 8.24,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPSR",
    "product_description": "BEEF-XP 1.8KG STRAWBERRY & RASPBERRY     [HS CODE:2106102090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.49,
    "median_seconds": 7.61,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW6C",
    "product_description": "CRITICAL WHEY 6KG CHOCOLATE",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 18.4,
    "median_seconds": 23.91,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPOM",
    "product_description": "BEEF-XP 1.8KG ORANGE MANGO     [HS CODE:2106102090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 6.02,
    "median_seconds": 7.17,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW825V",
    "product_description": "CRITICAL WHEY 825G VANILLA [HS CODE:2106108079]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.77,
    "median_seconds": 7.69,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 5",
    "sku_code": "MMMG2C",
    "product_description": "MUSCLE MOOSE MASS GAINER 2KG BAG - CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.91,
    "median_seconds": 7.9,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPCA",
    "product_description": "BEEF-XP 1.8KG CHERRY & APPLE   [HS CODE:2106102090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 5.59,
    "median_seconds": 6.24,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW6V",
    "product_description": "CRITICAL WHEY 6KG (BAG) VANILLA [HS CODE:2106108079]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 23.52,
    "median_seconds": 25.87,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 5",
    "sku_code": "OCMC6",
    "product_description": "ORIGINAL CRITICAL MASS CHOCOLATE 6Kg     [HS CODE:1806205090]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 19.32,
    "median_seconds": 22.08,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 5",
    "sku_code": "ISO18V",
    "product_description": "ISO-XP 1.8KG VANILLA",
    "imported_current_seconds": 6.85,
    "suggested_seconds": 7.88,
    "median_seconds": 8.11,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 5",
    "sku_code": "PERUISO1V",
    "product_description": "ISO-XP 1Kg VANILLA - PERU",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.53,
    "median_seconds": 7.17,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16CNC",
    "product_description": "ESSENTIAL PROTEIN 1.6KG COOKIES N CREAM [HS CODE:2106108079]",
    "imported_current_seconds": 6.25,
    "suggested_seconds": 8.1,
    "median_seconds": 8.68,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "NEUBFBP500BB",
    "product_description": "NOT FOR EU - BODYFUEL BEEF PROTEIN 500G BERRY BLAST",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 5.14,
    "median_seconds": 5.68,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16DC",
    "product_description": "ESSENTIAL PROTEIN DOUBLE CHOCOLATE 1.6KG",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.47,
    "median_seconds": 8.01,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW825BUENO",
    "product_description": "CRITICAL WHEY 825G CHOCO HAZELNUT (BUENO)     [HS CODE:1806907090]",
    "imported_current_seconds": 4.9,
    "suggested_seconds": 7.16,
    "median_seconds": 9.03,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16V",
    "product_description": "ESSENTIAL PROTEIN - VANILLA ICE CREAM 1.6KG",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.52,
    "median_seconds": 8.97,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2FRAP",
    "product_description": "CRITICAL WHEY 2KG FRAPPUCCINO     [HS CODE:2106108070]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 10.41,
    "median_seconds": 11.35,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPCM",
    "product_description": "BEEF-XP 1.8KG COLA MILLIONS   [HS CODE:2106102090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.91,
    "median_seconds": 7.63,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CWBAG450V",
    "product_description": "CRITICAL WHEY BAG 450G - VANILLA ICE CREAM     [HS CODE:2106108070]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 6.25,
    "median_seconds": 6.66,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16CH",
    "product_description": "ESSENTIAL PROTEIN 1.6KG CHOCOLATE HAZELNUT",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.52,
    "median_seconds": 8.15,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BFBP500BB",
    "product_description": "BODYFUEL BEEF PROTEIN 500G BERRY BLAST",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 6.01,
    "median_seconds": 6.14,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CORGS",
    "product_description": "CREAM OF RICE 2KG GOLDEN SYRUP     [HS CODE:2106909285]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 6.92,
    "median_seconds": 7.69,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2VM",
    "product_description": "CRITICAL WHEY 2KG VANILLA MATCHA     [HS CODE:2106108070]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 9.34,
    "median_seconds": 9.8,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16S",
    "product_description": "ESSENTIAL PROTEIN 1.6KG STRAWBERRY MILKSHAKE [HS CODE:2106108079]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.41,
    "median_seconds": 7.09,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFGAINER3BM",
    "product_description": "BEEF-XP GAINER 3.13KG - BLACKCURRANT MILLIONS     [HS CODE:2106102090]",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 12.01,
    "median_seconds": 13.9,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16SC",
    "product_description": "ESSENTIAL PROTEIN SALTED CARAMEL 1.6KG",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.5,
    "median_seconds": 7.17,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFGAINER3PM",
    "product_description": "BEEF-XP GAINER 3.13KG - PINEAPPLE MILLIONS     [HS CODE:2106102090]",
    "imported_current_seconds": 8.25,
    "suggested_seconds": 13.6,
    "median_seconds": 14.04,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "OCMS6",
    "product_description": "ORIGINAL CRITICAL MASS STRAWBERRY 6Kg     [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 18.45,
    "median_seconds": 19.97,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPCT",
    "product_description": "BEEF-XP 1.8KG CITRUS TWIST   [HS CODE:2106102090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 7.07,
    "median_seconds": 7.25,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "OCMCC6",
    "product_description": "ORIGINAL CRITICAL MASS COOKIES & CREAM 6Kg     [HS CODE:1806205090]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 16.09,
    "median_seconds": 19.28,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "OCMV6",
    "product_description": "ORIGINAL CRITICAL MASS VANILLA 6Kg     [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 16.82,
    "median_seconds": 20.36,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXPLM",
    "product_description": "BEEF-XP 1.8kg LEMON & MINT FLAVOUR [HS CODE:2106102090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.84,
    "median_seconds": 7.52,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2WBUENO",
    "product_description": "CRITICAL WHEY 2KG  WHITE CHOCOLATE HAZELNUT (BUENO)    [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.21,
    "median_seconds": 8.18,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2B",
    "product_description": "CRITICAL WHEY 2KG BANANA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.21,
    "median_seconds": 7.91,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 5",
    "sku_code": "COR1GS",
    "product_description": "CREAM OF RICE 1KG GOLDEN SYRUP     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.55,
    "median_seconds": 5.98,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BFBP500CB",
    "product_description": "BODYFUEL BEEF PROTEIN 500G CITRUS BURST",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.43,
    "median_seconds": 6.43,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFGAINER3CM",
    "product_description": "BEEF-XP GAINER 3.13KG - COLA MILLIONS     [HS CODE:2106102090]",
    "imported_current_seconds": 11.65,
    "suggested_seconds": 9.87,
    "median_seconds": 10.39,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16CB",
    "product_description": "ESSENTIAL PROTEIN CARAMEL BISCUIT 1.6KG",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.02,
    "median_seconds": 7.18,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BFBP500BR",
    "product_description": "BODYFUEL BEEF PROTEIN 500G BLUE RASPBERRY",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 6.24,
    "median_seconds": 6.24,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CORRR",
    "product_description": "CREAM OF RICE 2KG RASPBERRY RIPPLE     [HS CODE:2106909285]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 5.39,
    "median_seconds": 6.69,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW825CNC",
    "product_description": "CRITICAL WHEY 825G COOKIES N CREAM [HS CODE:2106108079]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.5,
    "median_seconds": 5.56,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CORUF",
    "product_description": "CREAM OF RICE 2KG UNFLAVOURED     [HS CODE:2106909285]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 8.36,
    "median_seconds": 9.17,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16B",
    "product_description": "ESSENTIAL PROTEIN - BANANA MILKSHAKE  1.6KG",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 9.0,
    "median_seconds": 9.18,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 5",
    "sku_code": "NEUBFBP500CB",
    "product_description": "NOT FOR EU -BODYFUEL BEEF PROTEIN 500G CITRUS BURST",
    "imported_current_seconds": 3.9,
    "suggested_seconds": 6.22,
    "median_seconds": 6.22,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "AUISOCLEARFF",
    "product_description": "AU ISO CLEAR 450G - FROZEN FRUIT",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.78,
    "median_seconds": 5.17,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "NEUBFWP900DC",
    "product_description": "NOT FOR EU - BODYFUEL WHEY PROTEIN 900G DOUBLE CHOCOLATE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 4.99,
    "median_seconds": 5.26,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "PERUCW2C",
    "product_description": "PERU - CRITICAL WHEY 2KG (BAG) CHOCOLATE [HS",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 10.96,
    "median_seconds": 11.4,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW825WCP",
    "product_description": "CRITICAL WHEY 825G WHITE CHOC PISTACHIO     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 8.09,
    "median_seconds": 8.89,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "COR1RR",
    "product_description": "CREAM OF RICE 1KG RASPBERRY RIPPLE     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 4.75,
    "median_seconds": 4.85,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW825S",
    "product_description": "CRITICAL WHEY 825G STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 4.97,
    "median_seconds": 5.01,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "KSABEEFXPBM",
    "product_description": "KSA BEEF-XP 1.8kg BLACKCURRANT MILLIONS FLAVOUR [HS CODE:2106102090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 7.4,
    "median_seconds": 9.11,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "COR1UN",
    "product_description": "CREAM OF RICE 1KG UNFLAVOURED     [HS CODE:2106909285]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 4.67,
    "median_seconds": 4.93,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 5",
    "sku_code": "OCM",
    "product_description": "ORIGINAL CRITICAL MASS BANANA 6Kg     [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 23.68,
    "median_seconds": 23.84,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "NEUCWBAG825C",
    "product_description": "NOT FOR EU CRITICAL WHEY BAG 825G - CHOCOLATE MILKSHAKE [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 8.03,
    "median_seconds": 8.03,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16WCC",
    "product_description": "ESSENTIAL PROTEIN 1.6KG WHITE CHOCOCLATE COCONUT [HS CODE:2106108079]",
    "imported_current_seconds": 6.25,
    "suggested_seconds": 7.0,
    "median_seconds": 7.1,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16PC",
    "product_description": "ESSENTIAL PROTEIN PEACHES & CREAM  1.6KG",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.73,
    "median_seconds": 7.05,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXP900OM",
    "product_description": "BEEF-XP 900G ORANGE MANGO",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.48,
    "median_seconds": 5.52,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP400DC",
    "product_description": "ESSENTIAL PROTEIN 400G DOUBLE CHOCOLATE",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 5.63,
    "median_seconds": 5.73,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXP900TV",
    "product_description": "BEEF-XP 900G TROPICAL VIBES [HS CODE:2106102090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 7.2,
    "median_seconds": 7.2,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "AUISOCLEARP",
    "product_description": "AU ISO CLEAR 450G - PINEAPPLE",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 5.98,
    "median_seconds": 5.98,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "OCMWC",
    "product_description": "ORIGINAL CRITICAL MASS WHITE CHOCOLATE BUENO 6Kg     [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 16.92,
    "median_seconds": 17.89,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXP900MB",
    "product_description": "BEEF-XP 900G MIXED BERRY",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 7.18,
    "median_seconds": 7.18,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP16IS",
    "product_description": "ESSENTIAL PROTEIN IBIZA SUNSET 1.6KG",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.07,
    "median_seconds": 6.14,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFGAINER3FB",
    "product_description": "BEEF-XP GAINER 3.13KG - FROZEN BERRIES     [HS CODE:2106102090]",
    "imported_current_seconds": 11.65,
    "suggested_seconds": 11.05,
    "median_seconds": 11.38,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP800CH",
    "product_description": "ESSENTIAL PROTEIN 800G CHOCOLATE HAZELNUT",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.44,
    "median_seconds": 5.44,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "NEUCWBAG825V",
    "product_description": "NOT FOR EU CRITICAL WHEY BAG 825G - VANILLA ICE CREAM [HS CODE:2106108070]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 6.56,
    "median_seconds": 6.56,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW825CL",
    "product_description": "CRITICAL WHEY 825G CARAMEL LATTE     [HS CODE:2106108070]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 6.26,
    "median_seconds": 6.26,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXP900SR",
    "product_description": "BEEF-XP 900G STRAWBERRY RASPBERRY",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 6.19,
    "median_seconds": 6.19,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "NEUCW825C",
    "product_description": "CRITICAL WHEY 825G CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.95,
    "median_seconds": 5.95,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "COR1AC",
    "product_description": "CREAM OF RICE 1KG APPLE CRUMBLE     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.67,
    "median_seconds": 6.67,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "AUBAGCORAC",
    "product_description": "AUSTRALIA CREAM OF RICE BAG 1.2KG APPLE CRUMBLE",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.13,
    "median_seconds": 5.13,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW825FRAP",
    "product_description": "CRITICAL WHEY 825G FRAPPUCCINO     [HS CODE:2106108070]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.2,
    "median_seconds": 5.2,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW825B",
    "product_description": "CRITICAL WHEY 825G BANANA     [HS CODE:2106108070]B",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 4.93,
    "median_seconds": 5.3,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "AUISOCLEARCF",
    "product_description": "AU ISO CLEAR 450G - COLA FREEZ",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 5.12,
    "median_seconds": 5.12,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXP900CM",
    "product_description": "BEEF-XP 900G COLA MILLIONS",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.31,
    "median_seconds": 5.31,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW825WBUENO",
    "product_description": "CRITICAL WHEY 825G WHITE CHOCOLATE HAZELNUT (BUENO)     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.9,
    "median_seconds": 5.9,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "NEUCWBAG825S",
    "product_description": "NOT FOR EU CRITICAL WHEY BAG 825G - STRAWBERRY MILKSHAKE [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.15,
    "median_seconds": 5.15,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFGAINER3T",
    "product_description": "BEEF-XP GAINER 3.13KG - TROPICAL VIBES     [HS CODE:2106102090]",
    "imported_current_seconds": 11.65,
    "suggested_seconds": 8.22,
    "median_seconds": 8.86,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXP900BR",
    "product_description": "BEEF-XP 900G BLUE RASPBERRY",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.79,
    "median_seconds": 5.79,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXP900LM",
    "product_description": "BEEF-XP 900G LEMON AND MINT",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 4.36,
    "median_seconds": 4.36,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP800DC",
    "product_description": "ESSENTIAL PROTEIN 800G DOUBLE CHOCOLATE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.09,
    "median_seconds": 5.09,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXP900CT",
    "product_description": "BEEF-XP 900G CITRUS TWIST",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 4.82,
    "median_seconds": 4.82,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "KSABEEFXPPM",
    "product_description": "KSA BEEF-XP 1.8kg PINEAPPLE MILLIONS FLAVOUR [HS CODE:2106102090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 7.85,
    "median_seconds": 7.9,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 5",
    "sku_code": "BEEFXP900BM",
    "product_description": "BEEF-XP 900G BLACKCURRANT MILLIONS FLAVOUR",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 4.16,
    "median_seconds": 4.16,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "CW2S-12",
    "product_description": "CRITICAL WHEY 2KG STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 9.87,
    "median_seconds": 9.87,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "NEUMMMG2C",
    "product_description": "NOT FOR EU MUSCLE MOOSE MASS GAINER 2KG BAG - CHOCOLATE",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 7.75,
    "median_seconds": 7.75,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 5",
    "sku_code": "AUBAGCORUN",
    "product_description": "AUSTRALIA CREAM OF RICE BAG 1.2KG UNFLAVOURED",
    "imported_current_seconds": 5.25,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 5",
    "sku_code": "AUBAGCORRR",
    "product_description": "AUSTRALIA CREAM OF RICE BAG 1.2KG RASPBERRY RIPPLE",
    "imported_current_seconds": 5.25,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 5",
    "sku_code": "EP800BN",
    "product_description": "ESSENTIAL PROTEIN 800G BANANA MILKSHAKE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 5",
    "sku_code": "AUISOCLEARBC",
    "product_description": "AU ISO CLEAR 450G - BLACKCURRANT",
    "imported_current_seconds": 3.5,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Line 6",
    "sku_code": "DWBAG450V",
    "product_description": "DIET WHEY (BAG) 450G VANILLA CREAM     [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.55,
    "median_seconds": 5.92,
    "sample_shifts": 13
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUDWBAG450V",
    "product_description": "NOT FOR EU - DIET WHEY (BAG) 450G VANILLA CREAM [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.6,
    "median_seconds": 6.22,
    "sample_shifts": 9
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMWPV",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900G - VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.96,
    "median_seconds": 6.14,
    "sample_shifts": 12
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2CNC",
    "product_description": "CRITICAL WHEY 2KG COOKIES N CREAM     [HS CODE:1806907090]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 9.17,
    "median_seconds": 10.6,
    "sample_shifts": 17
  },
  {
    "machine_name": "Line 6",
    "sku_code": "DWBAG450C",
    "product_description": "DIET WHEY (BAG) 450G CHOCOLATE DESSERT     [HS CODE:1806205090]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.89,
    "median_seconds": 6.09,
    "sample_shifts": 11
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2WBUENO",
    "product_description": "CRITICAL WHEY 2KG  WHITE CHOCOLATE HAZELNUT (BUENO)    [HS CODE:2106108070]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 10.55,
    "median_seconds": 11.08,
    "sample_shifts": 12
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW825V",
    "product_description": "CRITICAL WHEY 825G VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.95,
    "median_seconds": 6.12,
    "sample_shifts": 9
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUMMWPCOOKIE",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900G - COOKIES AND CREAM     [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.76,
    "median_seconds": 6.2,
    "sample_shifts": 10
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUMMWPV",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900G - VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 4.9,
    "suggested_seconds": 7.11,
    "median_seconds": 7.74,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUMMWPCHZ",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900g - CHOCOLATE HAZELNUT FLAVOUR      [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 6.19,
    "median_seconds": 6.55,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUDWBAG450C",
    "product_description": "NOT FOR EU - DIET WHEY (BAG) 450G CHOCOLATE DESSERT [HS CODE:1806205090]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.64,
    "median_seconds": 5.92,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUMMWPWCHZ",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900g - WHITE CHOCOLATE HAZELNUT  [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 8.72,
    "median_seconds": 9.54,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 12.36,
    "suggested_seconds": 10.16,
    "median_seconds": 11.6,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CMS24",
    "product_description": "CRITICAL MASS 2.4KG STRAWBERRY     [HS CODE:2106108031]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 8.08,
    "median_seconds": 8.91,
    "sample_shifts": 11
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2V",
    "product_description": "CRITICAL WHEY 2KG VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 8.06,
    "median_seconds": 9.67,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMWPWCHZ",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900g - WHITE CHOCOLATE HAZELNUT  [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 7.1,
    "median_seconds": 8.07,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CWBAG450V",
    "product_description": "CRITICAL WHEY BAG 450G - VANILLA ICE CREAM     [HS CODE:2106108070]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 5.99,
    "median_seconds": 6.33,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUDWBAG450S",
    "product_description": "NOT FOR EU - DIET WHEY (BAG) 450G STRAWBERRY MILKSHAKE [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 6.13,
    "median_seconds": 6.91,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2BUENO",
    "product_description": "CRITICAL WHEY 2KG CHOCO HAZELNUT (BUENO)     [HS CODE:1806907090]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 8.1,
    "median_seconds": 9.15,
    "sample_shifts": 8
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUMMWPS",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900G - STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.75,
    "median_seconds": 6.94,
    "sample_shifts": 5
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CMV24",
    "product_description": "CRITICAL MASS 2.4KG VANILLA [HS CODE:2106108031]",
    "imported_current_seconds": 8.25,
    "suggested_seconds": 7.84,
    "median_seconds": 9.0,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2FRAP",
    "product_description": "CRITICAL WHEY 2KG FRAPPUCCINO     [HS CODE:2106108070]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 7.19,
    "median_seconds": 8.78,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2CL",
    "product_description": "CRITICAL WHEY 2KG CARAMEL LATTE     [HS CODE:2106108070]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 9.92,
    "median_seconds": 10.54,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CMC24",
    "product_description": "CRITICAL MASS 2.4KG CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 8.25,
    "suggested_seconds": 6.6,
    "median_seconds": 7.48,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CMC6",
    "product_description": "CRITICAL MASS 6KG  CHOCOLATE     [HS CODE:1806205090]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 13.46,
    "median_seconds": 14.01,
    "sample_shifts": 7
  },
  {
    "machine_name": "Line 6",
    "sku_code": "BFISO18V",
    "product_description": "BODYFUEL PROTEIN ISOLATE 1.8KG - VANILLA",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 22.23,
    "median_seconds": 27.33,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMWPCHC",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900G - CHOCOLATE HONEYCOMB     [HS CODE:1806907090]",
    "imported_current_seconds": 6.1,
    "suggested_seconds": 6.29,
    "median_seconds": 7.02,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "DWBAG450S",
    "product_description": "DIET WHEY (BAG) 450G STRAWBERRY MILKSHAKE     [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.49,
    "median_seconds": 6.4,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUMMWPCHC",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900G - CHOCOLATE HONEYCOMB     [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 6.16,
    "median_seconds": 6.41,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW825WBUENO",
    "product_description": "CRITICAL WHEY 825gWHITE CHOCOLATE HAZELNUT (BUENO)     [HS CODE:1806907090]",
    "imported_current_seconds": 5.15,
    "suggested_seconds": 5.19,
    "median_seconds": 5.58,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CWBAG450C",
    "product_description": "CRITICAL WHEY BAG 450G - CHOCOLATE MILKSHAKE     [HS CODE:1806907090]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 5.83,
    "median_seconds": 5.92,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW825C",
    "product_description": "CRITICAL WHEY 825G CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 8.79,
    "suggested_seconds": 6.33,
    "median_seconds": 6.44,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "PERUISO18C",
    "product_description": "ISO-XP 1.8KG CHOCOLATE DESSERT PERU",
    "imported_current_seconds": 5.98,
    "suggested_seconds": 6.24,
    "median_seconds": 7.51,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2SC",
    "product_description": "CRITICAL WHEY 2KG SALTED CARAMEL     [HS CODE:2106108070]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 10.62,
    "median_seconds": 11.5,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMWPCHZ",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900g - CHOCOLATE HAZELNUT FLAVOUR      [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 5.37,
    "median_seconds": 5.76,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMDP450C",
    "product_description": "MUSCLE MOOSE DIET PROTEIN 450G - CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.35,
    "median_seconds": 5.71,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CM",
    "product_description": "CRITICAL MASS 6KG  BANANA     [HS CODE:2106108031]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 9.05,
    "median_seconds": 10.06,
    "sample_shifts": 6
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUMMWPDC",
    "product_description": "NOT FOR EU MUSCLE MOOSE WHEY PROTEIN 900G - DUBAI CHOCOLATE [HS CODE:1806907090]",
    "imported_current_seconds": 6.1,
    "suggested_seconds": 6.09,
    "median_seconds": 6.78,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2BS",
    "product_description": "CRITICAL WHEY 2KG CHIQUITA BANANA STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 9.96,
    "median_seconds": 10.6,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUBFWP900V",
    "product_description": "NOT FOR EU - BODYFUEL WHEY PROTEIN 900G VANILLA MILKSHAKE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 4.85,
    "median_seconds": 5.15,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "BFWP900WCP",
    "product_description": "BODYFUEL WHEY PROTEIN 900G WHITE CHOCOLATE PISTACHIO     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.57,
    "median_seconds": 5.71,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CMV6",
    "product_description": "CRITICAL MASS 6KG VANILLA [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 18.24,
    "median_seconds": 24.5,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO850V",
    "product_description": "ISO-XP 850G VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 4.9,
    "suggested_seconds": 6.01,
    "median_seconds": 6.56,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMWPDC",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900G - DUBAI CHOCOLATE [HS CODE:1806907090]",
    "imported_current_seconds": 5.55,
    "suggested_seconds": 4.89,
    "median_seconds": 5.7,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2S",
    "product_description": "CRITICAL WHEY 2KG STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 7.8,
    "suggested_seconds": 9.97,
    "median_seconds": 10.01,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CORTB",
    "product_description": "CREAM OF RICE 2KG TOFFEE BISCUIT     [HS CODE:2106909285]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.11,
    "median_seconds": 7.46,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "BASIXBEEF1PIT",
    "product_description": "BASIX CLEAR BEEF PROTEIN ISOLATE 1KG/2.2LB – PEACH ICED TEA     [HS CODE:2106102090]",
    "imported_current_seconds": 6.5,
    "suggested_seconds": 7.28,
    "median_seconds": 9.25,
    "sample_shifts": 4
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO450C",
    "product_description": "ISO-XP 450G CHOCOLAATE",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 8.15,
    "median_seconds": 8.21,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CMS6",
    "product_description": "CRITICAL MASS 6KG  STRAWBERRY     [HS CODE:2106108031]",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 17.41,
    "median_seconds": 17.48,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUMMDP450V",
    "product_description": "NOT FOR EU - MUSCLE MOOSE DIET PROTEIN 450G - VANILLA [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 7.44,
    "median_seconds": 7.44,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMWPS",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900G - STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.86,
    "median_seconds": 7.76,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "COR1TB",
    "product_description": "CREAM OF RICE 1KG TOFFEE BISCUIT     [HS CODE:2106909285]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.32,
    "median_seconds": 5.68,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMDP450V",
    "product_description": "MUSCLE MOOSE DIET PROTEIN 450G - VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 6.57,
    "median_seconds": 6.57,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMDP450SC",
    "product_description": "MUSCLE MOOSE DIET PROTEIN 450G - SALTED CARAMEL",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 6.9,
    "median_seconds": 6.9,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO18B",
    "product_description": "ISO-XP 1.8KG BANANA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.81,
    "median_seconds": 6.83,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO850C",
    "product_description": "ISO-XP CHOCOLATE 850G",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.91,
    "median_seconds": 6.21,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW825S",
    "product_description": "CRITICAL WHEY 825G STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 4.88,
    "median_seconds": 5.27,
    "sample_shifts": 3
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO450V",
    "product_description": "ISO-XP 450G VANILLA",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 4.77,
    "median_seconds": 5.34,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUBFWP900DC",
    "product_description": "NOT FOR EU - BODYFUEL WHEY PROTEIN 900G DOUBLE CHOCOLATE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.44,
    "median_seconds": 5.44,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-25",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 19.66,
    "median_seconds": 21.3,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUMMDP450C",
    "product_description": "NOT FOR EU - MUSCLE MOOSE DIET PROTEIN 450G - CHOCOLATE [HS CODE:1806907090]",
    "imported_current_seconds": 4.5,
    "suggested_seconds": 4.94,
    "median_seconds": 5.22,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUMMDP450SC",
    "product_description": "NOT FOR EU - MUSCLE MOOSE DIET PROTEIN 450G - SALTED CARAMEL",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 5.27,
    "median_seconds": 5.27,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "DWBAG450SC",
    "product_description": "DIET WHEY (BAG) 450G SALTED CARAMEL     [HS CODE:2106108070]",
    "imported_current_seconds": 4.75,
    "suggested_seconds": 5.04,
    "median_seconds": 5.08,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2VM",
    "product_description": "CRITICAL WHEY 2KG VANILLA MATCHA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 11.39,
    "median_seconds": 11.41,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO18C",
    "product_description": "ISO-XP 1.8KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 9.66,
    "median_seconds": 9.68,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-24",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.95,
    "median_seconds": 6.95,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO18CL",
    "product_description": "ISO-XP 1.8KG CAFE LATTE     [HS CODE:2106108070]",
    "imported_current_seconds": 6.25,
    "suggested_seconds": 7.66,
    "median_seconds": 8.41,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "BASIXBEEF2CC",
    "product_description": "BASIX CLEAR BEEF PROTEIN ISOLATE 2KG/4.4LB – CHERRY COLA KSA     [HS CODE:2106102090]",
    "imported_current_seconds": 10.0,
    "suggested_seconds": 6.81,
    "median_seconds": 7.07,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-23",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 18.76,
    "median_seconds": 18.76,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW825C-20",
    "product_description": "CRITICAL WHEY 825G CHOCOLATE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.98,
    "median_seconds": 6.98,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CASEINVAN",
    "product_description": "100% CASEIN 1.8KG VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.44,
    "median_seconds": 7.62,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO850CHONEY",
    "product_description": "ISO-XP CHOCO HONEYCOMB 850G",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 6.49,
    "median_seconds": 6.49,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "PAKCW825C",
    "product_description": "PAKISTAN CRITICAL WHEY 825G CHOCOLATE [HS CODE:2106108079]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 7.01,
    "median_seconds": 7.01,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW825SC",
    "product_description": "CRITICAL WHEY 825G SALTED CARAMEL     [HS CODE:2106108070]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 6.93,
    "median_seconds": 6.93,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO850CARAMEL",
    "product_description": "ISO-XP 850G - CHOCO CARAMEL",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.55,
    "median_seconds": 6.72,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW825C-21",
    "product_description": "CRITICAL WHEY 825G CHOCOLATE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.11,
    "median_seconds": 6.11,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CASEINBAG900S",
    "product_description": "100% CASEIN 900G BAG - STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.84,
    "median_seconds": 6.84,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO850PEANUT",
    "product_description": "<MULTIPLE VALUES>",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.2,
    "median_seconds": 6.2,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO850BUENO",
    "product_description": "ISO-XP 850G - CHOCO HAZELNUT",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.66,
    "median_seconds": 5.66,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMWPCOOKIE",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900G - COOKIES AND CREAM     [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 6.28,
    "median_seconds": 6.28,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "MMWPC",
    "product_description": "MUSCLE MOOSE WHEY PROTEIN 900G - CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.49,
    "median_seconds": 6.49,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO850CL",
    "product_description": "ISO-XP 850G CAFE LATTE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.01,
    "median_seconds": 6.01,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-22",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 11.16,
    "median_seconds": 11.16,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CASEINCHOC",
    "product_description": "100% CASEIN 1.8KG CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.12,
    "median_seconds": 6.12,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO850WCP",
    "product_description": "ISO-XP 850G WHITE CHOCOLATE PISTACHIO",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 5.96,
    "median_seconds": 5.96,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "BASIXBEEF1WM",
    "product_description": "BASIX CLEAR BEEF PROTEIN ISOLATE 1KG/2.2LB – WATERMELON [HS CODE:2106102090]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.47,
    "median_seconds": 5.48,
    "sample_shifts": 2
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW825C-19",
    "product_description": "CRITICAL WHEY 825G CHOCOLATE",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.34,
    "median_seconds": 5.34,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "BASIXBEEF2BR",
    "product_description": "BASIX CLEAR BEEF PROTEIN ISOLATE 2KG/4.4LB – BLUE RASPBERRY KSA [HS CODE:2106102090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.29,
    "median_seconds": 7.29,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CWBAG825V",
    "product_description": "CRITICAL WHEY BAG 825G - VANILLA ICE CREAM [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.4,
    "median_seconds": 5.4,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "NEUBFWP900WCP",
    "product_description": "BODYFUEL WHEY PROTEIN 900G WHITE CHOCOLATE PISTACHIO     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.81,
    "median_seconds": 5.81,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CASEINBAG900V",
    "product_description": "100% CASEIN 900G BAG - VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 5.3,
    "median_seconds": 5.3,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-33",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 10.46,
    "median_seconds": 10.46,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO18V",
    "product_description": "ISO-XP 1.8KG VANILLA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 9.56,
    "median_seconds": 9.56,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2B",
    "product_description": "CRITICAL WHEY 2KG BANANA     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 11.55,
    "median_seconds": 11.55,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-28",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 10.81,
    "median_seconds": 10.81,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CMWC24",
    "product_description": "CRITICAL MASS 2.4KG WHITE CHOCOLATE RASPBERRY     [HS CODE:2106108031]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 7.76,
    "median_seconds": 7.76,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO850CH",
    "product_description": "ISO-XP CHOCO HAZELNUT 850G",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 7.04,
    "median_seconds": 7.04,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "KSACW825C",
    "product_description": "KSA CRITICAL WHEY 825G CHOCOLATE [HS CODE:1806907090]",
    "imported_current_seconds": 4.8,
    "suggested_seconds": 7.58,
    "median_seconds": 7.58,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-26",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 9.64,
    "median_seconds": 9.64,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-29",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 10.08,
    "median_seconds": 10.08,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-27",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 9.62,
    "median_seconds": 9.62,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "ISO18S",
    "product_description": "ISO-XP 1.8KG STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 8.37,
    "median_seconds": 8.37,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-32",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 8.86,
    "median_seconds": 8.86,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-31",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 9.13,
    "median_seconds": 9.13,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CASEINBAG900C",
    "product_description": "100% CASEIN 900G BAG - CHOCOLATE     [HS CODE:1806907090]",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 6.81,
    "median_seconds": 6.81,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CASEINSTRAW",
    "product_description": "100% CASEIN 1.8KG STRAWBERRY     [HS CODE:2106108070]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.27,
    "median_seconds": 6.27,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "PERUISO1C",
    "product_description": "ISO-XP 1Kg CHOCOLATE DESSERT - PERU",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 6.0,
    "median_seconds": 6.0,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "KSACMV24",
    "product_description": "KSA CRITICAL MASS 2.4KG VANILLA (POWDER) IDRAJ No. P-3-N-020719-103503",
    "imported_current_seconds": 8.25,
    "suggested_seconds": 9.16,
    "median_seconds": 9.16,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "CW2C-30",
    "product_description": "CRITICAL WHEY 2KG CHOCOLATE",
    "imported_current_seconds": 5.75,
    "suggested_seconds": 6.44,
    "median_seconds": 6.44,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "KSACMV6",
    "product_description": "KSA CRITICAL MASS 6KG  VANILLA (POWDER) IDRAJ No. P-3-N-020719-103805",
    "imported_current_seconds": 15.5,
    "suggested_seconds": 8.87,
    "median_seconds": 8.87,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "BASIXBEEF1EF",
    "product_description": "BASIX CLEAR BEEF PROTEIN ISOLATE 1KG/2.2LB – ENERGY FUSION [HS CODE:2106102090]",
    "imported_current_seconds": 5.25,
    "suggested_seconds": 5.4,
    "median_seconds": 5.4,
    "sample_shifts": 1
  },
  {
    "machine_name": "Line 6",
    "sku_code": "BASIXBEEF2WM",
    "product_description": "BASIX CLEAR BEEF PROTEIN ISOLATE 2KG/4.4LB – WATERMELON KSA      [HS CODE:2106102090]",
    "imported_current_seconds": 5.75,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERGYFB",
    "product_description": "GEL ENDURANCE - ENERGY FRUIT BURST x 20 UNITS",
    "imported_current_seconds": 2.5,
    "suggested_seconds": 2.07,
    "median_seconds": 2.1,
    "sample_shifts": 6
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENDURANCE ENERGY VIMTO",
    "product_description": "GEL ENDURANCE ENERGY VIMTO",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.04,
    "median_seconds": 2.08,
    "sample_shifts": 8
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERVIMTO",
    "product_description": "GEL ENERGY VIMTO 60G",
    "imported_current_seconds": 3.0,
    "suggested_seconds": 2.08,
    "median_seconds": 2.12,
    "sample_shifts": 4
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ENDURANCE ENERGY VIMTO",
    "product_description": "GEL ENDURANCE ENERGY VIMTO 60G",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 2.09,
    "median_seconds": 2.12,
    "sample_shifts": 5
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERGYORAN",
    "product_description": "GEL ENDURANCE - ENERGY ORANGE x 20 UNITS [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.09,
    "median_seconds": 2.09,
    "sample_shifts": 6
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERGYLL",
    "product_description": "GEL ENDURANCE - ENERGY LEMON & LIME x 20 UNITS [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.08,
    "median_seconds": 2.11,
    "sample_shifts": 4
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENDNERFB",
    "product_description": "GEL ENDURANCE ENERGY FRUIT BURST 60G",
    "imported_current_seconds": 3.8,
    "suggested_seconds": 2.07,
    "median_seconds": 2.07,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "IBCGLP1COLMB",
    "product_description": "IBC GLP1 COLLAGEN MIXED BERRY",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.19,
    "median_seconds": 2.21,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "ABECHCO IBC1",
    "product_description": "GEL ABE CHERRY COLA 60G",
    "imported_current_seconds": 3.0,
    "suggested_seconds": 2.05,
    "median_seconds": 2.07,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERGYBC",
    "product_description": "GEL ENDURANCE - ENERGY BLACKCURRANT x 20 UNITS     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.1,
    "median_seconds": 2.11,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELBODYFUELBB",
    "product_description": "GEL BODY FUEL ENERGY X20 - BERRY BLAST [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.15,
    "median_seconds": 2.25,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELBODYFUELLL",
    "product_description": "GEL BODY FUEL ENERGY X20 - LEMON AND LIME     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 2.28,
    "median_seconds": 2.54,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ENDURANCE ENERGYFB - 60",
    "product_description": "GEL ENDURANCE ENERGY FRUIT BURST - 60G",
    "imported_current_seconds": 7.5,
    "suggested_seconds": 2.03,
    "median_seconds": 2.05,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELBREATHEBC IBC1",
    "product_description": "GEL ENDURANCE - BREATHE BLACKCURRANT x 20 UNITS [HS CODE:2106909285]",
    "imported_current_seconds": 3.0,
    "suggested_seconds": 2.05,
    "median_seconds": 2.06,
    "sample_shifts": 4
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENDURANCE ENERGY FRUIT BURST",
    "product_description": "GEL ENDURANCE ENERGY FRUIT BURST",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 2.11,
    "median_seconds": 2.15,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL VIMTO IBC1",
    "product_description": "GEL ENDURANCE ENERGY  VIMTO 60G",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.11,
    "median_seconds": 2.13,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERGYCOLA",
    "product_description": "GEL ENDURANCE - ENERGY COLA x 20 UNITS     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.06,
    "median_seconds": 2.07,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELELITEENOB",
    "product_description": "GEL ENDURANCE - ELITE PERFORMANCE GEL 20 x 60ML ORANGE BURST",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.06,
    "median_seconds": 2.09,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELVIMTO",
    "product_description": "GEL ENDURANCE ENERGY VIMTO 60G",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.12,
    "median_seconds": 2.12,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ENDURANCE BREATHE BLACKCURRANT",
    "product_description": "GEL ENDURANCE BREATHE BLACKCURRANT",
    "imported_current_seconds": 3.8,
    "suggested_seconds": 2.1,
    "median_seconds": 2.11,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELEEBC60G",
    "product_description": "GEL ENDURANCE ENERGY BLACKCURRANT 60G",
    "imported_current_seconds": 3.8,
    "suggested_seconds": 2.08,
    "median_seconds": 2.09,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ABE CANDY ICE BLAST",
    "product_description": "GEL ABE CANDY ICE BLAST",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.03,
    "median_seconds": 2.06,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENDURANCE ENERGY ORANGE",
    "product_description": "GEL ENDURANCE ENERGY ORANGE 60G",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 2.06,
    "median_seconds": 2.08,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELMARCOL",
    "product_description": "GEL MARINE COLLAGEN STRAWBERRY & RASPBERRY",
    "imported_current_seconds": 3.0,
    "suggested_seconds": 2.12,
    "median_seconds": 2.12,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ABE ENERGY",
    "product_description": "GEL ABE ENERGY 60G",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 2.02,
    "median_seconds": 2.02,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELELITEENAB",
    "product_description": "GEL ENDURANCE - ELITE PERFORMANCE GEL 20 x 60ML APPLE BURST",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.07,
    "median_seconds": 2.08,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELABEEN",
    "product_description": "GEL ABE ENERGY FLAVOUR X 20 UNITS     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.05,
    "median_seconds": 2.06,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERGYTROP - IBC 1",
    "product_description": "GEL ENDURANCE - ENERGY TROPICAL x 20 UNITS     [HS CODE:2106909285]",
    "imported_current_seconds": 2.75,
    "suggested_seconds": 2.13,
    "median_seconds": 2.16,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "MARCOLSR",
    "product_description": "GEL MARINE COLLAGEN STRAWBERRY & RASPBERRY",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.14,
    "median_seconds": 2.15,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENDENERGY - IBC 1",
    "product_description": "GEL ENDURANCE ENERGY BLACKCURRANT 60G",
    "imported_current_seconds": 0.7,
    "suggested_seconds": 2.06,
    "median_seconds": 2.08,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "1GELENERGYFB",
    "product_description": "1 SINGLE GEL ENDURANCE - ENERGY FRUIT BURST     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.02,
    "median_seconds": 2.06,
    "sample_shifts": 3
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENDURANCE ENERGY VIMTO - IBC 2",
    "product_description": "GEL ENDURANCE ENERGY VIMTO",
    "imported_current_seconds": 2.0,
    "suggested_seconds": 2.2,
    "median_seconds": 2.3,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ENDURANCE VIMTO 60",
    "product_description": "GEL ENDURANCE VIMTO 60G",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 2.2,
    "median_seconds": 2.2,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERGYTROP - IBC 2",
    "product_description": "GEL ENDURANCE - ENERGY TROPICAL x 20 UNITS     [HS CODE:2106909285]",
    "imported_current_seconds": 2.8,
    "suggested_seconds": 2.44,
    "median_seconds": 2.44,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ENDURANCE ENERGY VARIETY COLA",
    "product_description": "GEL ENDURANCE ENERGY VARIETY COLA",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.19,
    "median_seconds": 2.21,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELBODYFUELO - IBC 2",
    "product_description": "GEL BODY FUEL ENERGY X20 - ORANGE     [HS CODE:2106909285]",
    "imported_current_seconds": 3.0,
    "suggested_seconds": 2.35,
    "median_seconds": 2.35,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELCOLA IBC 1",
    "product_description": "GEL ENDURANCE ENERGY COLA 60G",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.12,
    "median_seconds": 2.12,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ENDURANCE ENERGY VARIETY BLACKCURRANT",
    "product_description": "GEL ENDURANCE ENERGY BLACKCURRANT",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.27,
    "median_seconds": 2.28,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ENDURANCE ENERGY VARIETY LEMON LIME",
    "product_description": "GEL ENDURANCE ENERGY VARIETY LEMON LIME",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.08,
    "median_seconds": 2.13,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL VIMTO IBC2",
    "product_description": "GEL ENDURANCE ENERGY  VIMTO 60G",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.15,
    "median_seconds": 2.15,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERGY6",
    "product_description": "GELS 6 PACK VARIETY - ENERGY [HS CODE:2106909285]",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 2.11,
    "median_seconds": 2.11,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ENDURANCE ENERGY VARIETY ORANGE",
    "product_description": "GEL ENDURANCE ENERGY VARIETY ORANGE",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.12,
    "median_seconds": 2.19,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ENDURANCE ENERGY VARIETY TROPICAL",
    "product_description": "GEL ENDURANCE ENERGY VARIETY TROPICAL",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.2,
    "median_seconds": 2.2,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERGYCOLA - IBC 1",
    "product_description": "GEL ENDURANCE - ENERGY COLA x 20 UNITS     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.09,
    "median_seconds": 2.09,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GEL ENDURANCE ENERGY BLACK CURRANT",
    "product_description": "GEL ENDURANCE ENERGY BLACKCURRANT",
    "imported_current_seconds": 15.0,
    "suggested_seconds": 2.03,
    "median_seconds": 2.04,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELCOLA IBC 2",
    "product_description": "GEL ENDURANCE ENERGY COLA 60G",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.1,
    "median_seconds": 2.1,
    "sample_shifts": 2
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELCOLA IBC1",
    "product_description": "GEL ENDURANCE BREATHE COLA",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.12,
    "median_seconds": 2.12,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELBODYFUELO - IBC 1",
    "product_description": "GEL BODY FUEL ENERGY X20 - ORANGE     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.46,
    "median_seconds": 2.46,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELENERGYCOLA - IBC 2",
    "product_description": "GEL ENDURANCE - ENERGY COLA x 20 UNITS     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 2.12,
    "median_seconds": 2.12,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "ENDUENERGY",
    "product_description": "ENDURANCE ENERGY TROPICAL 60G",
    "imported_current_seconds": 3.0,
    "suggested_seconds": 2.0,
    "median_seconds": 2.0,
    "sample_shifts": 1
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "MCOLGELSR",
    "product_description": "GEL MARINE COLLAGEN STRAWBERRY & RASPBERRY 30G",
    "imported_current_seconds": 3.0,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "1GELENERGYORAN",
    "product_description": "1 SINGLE GEL ENDURANCE - ENERGY ORANGE     [HS CODE:2106909285]",
    "imported_current_seconds": 3.5,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELBFLM IBC 1",
    "product_description": "GEL BODYFUEL ENERGY LEMON & LIME  - 60G",
    "imported_current_seconds": 3.5,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Gel Machine",
    "sku_code": "GELESPBLACK IBC1",
    "product_description": "GEL ENDURANCE SPRINT BLACKCURRANT",
    "imported_current_seconds": 3.0,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "MULTIVITAMIN",
    "product_description": "MULTIVITAMIN 1 - 90 CAPSULES",
    "imported_current_seconds": 2.5,
    "suggested_seconds": 4.43,
    "median_seconds": 4.59,
    "sample_shifts": 14
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "BER",
    "product_description": "BERBERINE 1000MG WITH ASTRAGIN - 60 CAPSULES     [HS CODE:2106909285]",
    "imported_current_seconds": 1.5,
    "suggested_seconds": 1.54,
    "median_seconds": 1.57,
    "sample_shifts": 11
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "PAKMULTIVITAMIN",
    "product_description": "PAKISTAN MULTI-VITAMIN 90 CAPS [HS CODE:2106909285]",
    "imported_current_seconds": 4.25,
    "suggested_seconds": 4.17,
    "median_seconds": 4.24,
    "sample_shifts": 5
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "CREATINE 3000",
    "product_description": "CREATINE 3000 - 120 CAPSULES",
    "imported_current_seconds": 3.8,
    "suggested_seconds": 4.77,
    "median_seconds": 4.95,
    "sample_shifts": 6
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "ASHWA",
    "product_description": "ASHWAGANDHA KSM66 + ASTRAGIN 60 CAPSULES     [HS CODE:2106909285]",
    "imported_current_seconds": 4.0,
    "suggested_seconds": 4.04,
    "median_seconds": 4.1,
    "sample_shifts": 6
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "OME3",
    "product_description": "OMEGA 3 - 100 SOFT GELS",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 2.91,
    "median_seconds": 3.54,
    "sample_shifts": 6
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "BFOXYCAPS",
    "product_description": "BODYFUEL OXYBURN CAPSULES - 60 CAPS,  30 SERVS.",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 3.8,
    "median_seconds": 3.84,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "BERBERINE",
    "product_description": "BERBERINE 1000MG - 60 CAPSULES",
    "imported_current_seconds": 1.25,
    "suggested_seconds": 1.16,
    "median_seconds": 1.22,
    "sample_shifts": 5
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "CRE3000",
    "product_description": "CREATINE 3000 120caps     [HS CODE:2106909285]",
    "imported_current_seconds": 4.63,
    "suggested_seconds": 4.7,
    "median_seconds": 4.81,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SOLCOLLAGEN",
    "product_description": "SOLUTIONS COLLAGEN 60 CAPSULES",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.06,
    "median_seconds": 4.16,
    "sample_shifts": 4
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "TONGKATALI",
    "product_description": "TONGKAT ALI x 60 CAPSULES",
    "imported_current_seconds": 3.2,
    "suggested_seconds": 1.43,
    "median_seconds": 1.58,
    "sample_shifts": 4
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "ZINCMAG",
    "product_description": "ZINC, MAGNESIUM & VITAMIN B6 CAPSULES - 90 CAPS",
    "imported_current_seconds": 1.3,
    "suggested_seconds": 1.47,
    "median_seconds": 1.61,
    "sample_shifts": 4
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SOLTRISLA",
    "product_description": "SOLUTIONS TRI BLEND SHILAJIT, LIONS MANE, ASHWAGANDA 60 CAPSULES",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.0,
    "median_seconds": 4.0,
    "sample_shifts": 3
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "ZINC, MAGNESIUM &",
    "product_description": "ZINC, MAGNESIUM & B6 (ZMA) - 90 CAPSULES",
    "imported_current_seconds": 2.0,
    "suggested_seconds": 1.92,
    "median_seconds": 1.96,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "ZINC",
    "product_description": "ZINC - CAPSULES",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 4.18,
    "median_seconds": 4.32,
    "sample_shifts": 4
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "BFOME3",
    "product_description": "BODYFUEL OMEGA 3 1000mg 60 SOFT GELS",
    "imported_current_seconds": 3.0,
    "suggested_seconds": 2.91,
    "median_seconds": 3.05,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "HSN",
    "product_description": "HAIR, SKIN & NAILS - 60 CAPSULES",
    "imported_current_seconds": 1.5,
    "suggested_seconds": 1.58,
    "median_seconds": 1.72,
    "sample_shifts": 4
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SOLTURMERIC",
    "product_description": "SOLUTIONS TURMERIC - 60 CAPSULES",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.57,
    "median_seconds": 3.59,
    "sample_shifts": 3
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "TUDCA+NAC 90 CAP",
    "product_description": "TUDCA+NAC 90 CAPSULES",
    "imported_current_seconds": 1.75,
    "suggested_seconds": 1.78,
    "median_seconds": 1.83,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SOLCOL",
    "product_description": "SOLUTIONS COLLAGEN - 60 CAPSULES",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 4.25,
    "median_seconds": 4.32,
    "sample_shifts": 3
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "TESTX",
    "product_description": "TEST-X 120 V CAPS (30 SERVINGS) [HS CODE:2106909285]",
    "imported_current_seconds": 1.8,
    "suggested_seconds": 1.75,
    "median_seconds": 1.75,
    "sample_shifts": 3
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "NEUSOLCOLLAGEN",
    "product_description": "NOT FOR EU - SOLUTIONS COLLAGEN - 60 CAPSULES",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 4.6,
    "median_seconds": 4.68,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SOLGUT",
    "product_description": "SOLUTIONS GUT HEALTH 60 CAPSULES     [HS CODE:2106909285]",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 4.3,
    "median_seconds": 4.31,
    "sample_shifts": 3
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "TUDCA+NAC",
    "product_description": "TUDCA + NAC 90 CAPSULES     [HS CODE:2106909285]",
    "imported_current_seconds": 1.3,
    "suggested_seconds": 1.48,
    "median_seconds": 1.52,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SOLDETOX",
    "product_description": "SHILAJIT - 90 CAPSULES",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 3.77,
    "median_seconds": 3.79,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "CAFFENDU",
    "product_description": "ENDURANCE CAFFEINE - 90 CAPSULES",
    "imported_current_seconds": 1.6,
    "suggested_seconds": 1.47,
    "median_seconds": 1.54,
    "sample_shifts": 3
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SBM120",
    "product_description": "SEX BOMB MALE LIBIDO ENHANCER     [HSCODE:\t2106909285]",
    "imported_current_seconds": 1.8,
    "suggested_seconds": 5.68,
    "median_seconds": 5.92,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "VIT-C1000",
    "product_description": "VITAMIN C",
    "imported_current_seconds": 5.0,
    "suggested_seconds": 7.19,
    "median_seconds": 7.32,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "HMB",
    "product_description": "HMB 500MG 120 VEGGIE CAPS     [HS CODE:2106909285]",
    "imported_current_seconds": 4.5,
    "suggested_seconds": 5.93,
    "median_seconds": 6.26,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "DIGESTIVE",
    "product_description": "DIGESTIVE - 60 CAPSULES",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 1.32,
    "median_seconds": 1.35,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "CLA-LCAR100",
    "product_description": "CLA L-CARNITINE & GREEN TEA - 100 CAPSULES",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 1.97,
    "median_seconds": 2.28,
    "sample_shifts": 3
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "CITBERGA",
    "product_description": "CITRUS BERGAMOT - 60 CAPSULES",
    "imported_current_seconds": 4.0,
    "suggested_seconds": 1.45,
    "median_seconds": 1.6,
    "sample_shifts": 3
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "MAGD3",
    "product_description": "MAGNESIUM & VITAMIN D3 - 60 CAPSULES",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 3.91,
    "median_seconds": 3.91,
    "sample_shifts": 3
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "BFMULT",
    "product_description": "BODY FUEL MULTIVITAMIN - 60 CAPSULES",
    "imported_current_seconds": 3.8,
    "suggested_seconds": 4.33,
    "median_seconds": 4.4,
    "sample_shifts": 3
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "CALCIUMK2",
    "product_description": "CALCIUM & VITAMIN K2 - 60 CAPSULES",
    "imported_current_seconds": 3.5,
    "suggested_seconds": 4.07,
    "median_seconds": 4.23,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SHILAJIT",
    "product_description": "SHILAJIT - 90 CAPSULES",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 1.46,
    "median_seconds": 1.46,
    "sample_shifts": 1
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "VITD3",
    "product_description": "VITAMIN D3 - 90 CAPSULES",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 4.71,
    "median_seconds": 4.71,
    "sample_shifts": 1
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "",
    "product_description": "VITAMIN B12 90 VEGGIE CAPSULES     [HS CODE:2106909285]",
    "imported_current_seconds": 1.8,
    "suggested_seconds": 4.81,
    "median_seconds": 4.83,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "CITBERG",
    "product_description": "CITRUS BERGAMOT - 60 CAPSULES",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 1.5,
    "median_seconds": 1.58,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SHREDX",
    "product_description": "SHRED-X - 90 CAPSULES",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 5.17,
    "median_seconds": 5.76,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SOLMENO",
    "product_description": "SOLUTIONS MENOPAUSE COMPLEX - 60 CAPSULES",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 4.28,
    "median_seconds": 4.43,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "L-ARGININE",
    "product_description": "L-ARGININE - 120 CAPSULES",
    "imported_current_seconds": 3.1,
    "suggested_seconds": 5.75,
    "median_seconds": 5.85,
    "sample_shifts": 2
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "TEST-X",
    "product_description": "TEST-X - 120 CAPSULES",
    "imported_current_seconds": 4.0,
    "suggested_seconds": 2.01,
    "median_seconds": 2.01,
    "sample_shifts": 1
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "GLP1DIG",
    "product_description": "GLP1 DIGEST CAPS (90CAPS 30 SERV)",
    "imported_current_seconds": 1.0,
    "suggested_seconds": 1.31,
    "median_seconds": 1.31,
    "sample_shifts": 1
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "TURKESTERON ( TURK-X) 90 CAPSULES",
    "product_description": "TURKESTERONE (TURK-X) 90 CAPSULE",
    "imported_current_seconds": 1.75,
    "suggested_seconds": 1.57,
    "median_seconds": 1.57,
    "sample_shifts": 1
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SOLCRECAPS",
    "product_description": "SOLUTIONS CREATINE MONOHYDRATE CAPSULES (60 CAPSULES)",
    "imported_current_seconds": 2.9,
    "suggested_seconds": 3.64,
    "median_seconds": 3.64,
    "sample_shifts": 1
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "GLUT4K",
    "product_description": "GLUTAMINE 4K 120 VEGGI CAPS     [HS CODE:2106909285]",
    "imported_current_seconds": 2.5,
    "suggested_seconds": 5.45,
    "median_seconds": 5.45,
    "sample_shifts": 1
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "SBF120",
    "product_description": "SEX BOMB FEMALE - 120 CAPSULES",
    "imported_current_seconds": 1.9,
    "suggested_seconds": 4.85,
    "median_seconds": 4.85,
    "sample_shifts": 1
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "US-SHREDX",
    "product_description": "SHRED X 90 VEGGIE CAPSULES     [HS CODE:2106909285]",
    "imported_current_seconds": 2.5,
    "suggested_seconds": 4.83,
    "median_seconds": 4.83,
    "sample_shifts": 1
  },
  {
    "machine_name": "Tablet Line",
    "sku_code": "USHRED-X",
    "product_description": "US SHRED-X - 90 CAPSULES",
    "imported_current_seconds": 2.9,
    "suggested_seconds": null,
    "median_seconds": null,
    "sample_shifts": null
  }
]$fill_seed$::jsonb)
AS seed(machine_name text, sku_code text, product_description text, imported_current_seconds numeric,
        suggested_seconds numeric, median_seconds numeric, sample_shifts integer);
