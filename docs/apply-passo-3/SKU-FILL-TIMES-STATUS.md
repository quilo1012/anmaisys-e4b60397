# Shared SKU fill times — awaiting production activation

The migration `supabase/migrations/20261126074500_sku_fill_times_candidates.sql` is prepared but **not applied**. This session cannot apply it to AN Maintenance production. Do not apply it to the old Lovable Cloud fallback database.

It creates a separate candidate/review register, with 827 machine/SKU records from `fill_times_sugeridos.csv`, across ten machines. Twenty-two records have no suggested time; those values remain null. The current imported value, P20 suggestion, median and shift sample count remain separate. Existing production histories, iTouch values, approved targets and local pack-size corrections are untouched.

No candidate is automatically approved. The file does not declare whether seconds represent one unit or one machine cycle. Approval requires a confirmed basis; cycle-based approval also requires units per cycle. The Line 4 CRE250 row preserves 2.08 suggested seconds, 2.28 median seconds and 108 shifts, without assuming that either is a validated running-only time.

Pending steps:
1. Confirm the CSV time basis and inspect production's existing SKU authorization rules before applying the prepared migration there.
2. Apply and verify counts and permitted/denied reads and writes in AN Maintenance production.
3. Wire the Fill speed matrix SKU editor to the shared register and verify save/read-back under a real production session. The current pack-size editor still saves only in this browser; this migration does not change that behavior.
4. Keep the original Time & Motion pack-size reference separate. Do not distribute browser-only pack corrections across every SKU of the same size or silently overwrite approved SKU standards on import.

No publishing or deployment was performed.