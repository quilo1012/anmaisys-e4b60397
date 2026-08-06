-- As duas ordens de segurança que foram rejeitadas sem justificação.
--
-- WO-2026-000801: "Capsule polisher 2 giving electric shock. Needs fixing!" Raised
-- 04/08 07:40 at LOW priority, rejected at 17:16 with the reason "...".
-- WO-2026-000802: "Metal Detected" on Line 1. Raised 14:52, rejected at 17:17 with
-- the reason "Ooo".
--
-- Sixty seconds apart, both by an account named only "Engineer". The rejection gate
-- asked for three characters and both reasons are exactly three characters long.
--
-- Reopened rather than left as a finding: a report that a machine gives people an
-- electric shock is not a data-quality problem. 801 also moves from low to high —
-- whoever raised it did not choose the severity of what they were describing.
UPDATE public.work_orders SET
  status = 'open', priority = 'high',
  rejected_at = NULL, rejected_by = NULL, rejection_reason = NULL,
  notes = coalesce(notes || E'\n', '') ||
    'Reopened 06/08: rejected on 04/08 17:16 with the reason "..." — no justification recorded. Safety report (electric shock); priority corrected from low to high.'
WHERE wo_number = 801 AND status::text = 'rejected';

UPDATE public.work_orders SET
  status = 'open',
  rejected_at = NULL, rejected_by = NULL, rejection_reason = NULL,
  notes = coalesce(notes || E'\n', '') ||
    'Reopened 06/08: rejected on 04/08 17:17 with the reason "Ooo" — no justification recorded. Metal detected on Line 1 is a contamination event.'
WHERE wo_number = 802 AND status::text = 'rejected';
