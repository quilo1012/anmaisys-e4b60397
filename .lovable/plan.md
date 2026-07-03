# Production Flow Improvements

Four coordinated changes across the Operator screen, RAG Weekly integration, and Production Control (Admin).

---

## FIX 1 — Operator Target must come from RAG Weekly

**Problem:** Operator screens currently show `target_qty` / `planned_qty` from `production_items` (populated by SKU/iTouching import). These do not represent the shift target — the source of truth for the Operator is `rag_weekly_entries.plan_qty`.

**Change:**
- In every place the Operator sees a "Target" number, read `rag_weekly_entries.plan_qty` for `(entry_date=today, line, shift)`.
- Never fall back to iTouching qty for the Operator target.

**Files touched:**
- `src/pages/dashboard/LineProductionScreen.tsx` — replace per-item target with RAG plan_qty for the shift-level KPI; SKU cards keep `target_qty` (per-SKU split from `sync_items_target_from_rag`).
- `src/pages/dashboard/LineDisplayScreen.tsx` — already uses `rag.plan_qty` for KPI; verify SKU-level target label uses the same source.
- `src/pages/dashboard/OperatorPreviewPage.tsx` — inherits from LineProductionScreen (no separate change).

---

## NEW 2 — "Production Input" section on Operator screen

New card block on `LineProductionScreen.tsx`, above Shift Observations:

```
Production Input                                 [Save shift totals]
──────────────────────────────────────────────────────────────────
SKU  PACK-001  Whey Vanilla 2kg      Target (RAG): 12,000
  Blender 1  [   3200 ]
  Blender 2  [   2900 ]
  Blender 3  [      0 ]
  Blender 4  [      0 ]
                                      Subtotal: 6,100

SKU  PACK-002  Creatine 500g          Target (RAG): 8,000
  (single entry — no blender split)   [   7,800 ]

──────────────────────────────────────────────────────────────────
Total Produced This Shift:   [ 13,900 ]  (editable, defaults to sum)
Last saved: 26/06 18:04 by Bruno Silva
```

Rules:
- One card per distinct SKU appearing in the shift's `production_items`.
- Blender split shows only when the same SKU repeats in the shift OR the SKU has a blender-linked history — else a single input.
- Subtotal auto = sum of blender inputs (read-only).
- "Total Produced This Shift" defaults to sum of subtotals but is editable.
- Save = upsert one `production_blender_entries` row per blender + write the shift total to `rag_weekly_entries.actual_qty`, stamping `updated_at` and a new `updated_by` column. Second save for same shift REPLACES prior values (delete-then-insert scoped to session).

---

## NEW 3 — Per-blender production tracking

New table:

```sql
create table public.production_blender_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.production_sessions(id) on delete cascade,
  production_item_id uuid not null references public.production_items(id) on delete cascade,
  blender_number smallint not null check (blender_number between 1 and 4),
  quantity integer not null default 0 check (quantity >= 0),
  entered_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_item_id, blender_number)
);
```

- GRANTs for `authenticated` + `service_role`, RLS: operators can insert/update rows for sessions on their bound line; admin/manager full access.
- Trigger `sync_item_actual_from_blenders`: after insert/update/delete, recompute `production_items.actual_qty = SUM(blender_entries.quantity)` for that item; existing `sync_rag_actual_from_items` then rolls it up to RAG.
- `rag_weekly_entries`: add `actual_updated_by uuid` column, stamped on manual Operator save.

**Consumers:**
- Shift History (breakdown drawer): show blender rows per item.
- Production Control (Admin): expand row reveals Blender 1..N chips.

---

## FIX 4 — Inline Actual edit in Production Control (Admin)

`src/pages/dashboard/ShiftHistoryPage.tsx` (Production Control table):

- Remove the "Edit actual" dialog trigger.
- Actual column becomes a controlled numeric `<input>` in-cell.
- On focus: highlight row (`bg-primary/5`).
- Auto-save on `Enter` or `blur` if value changed → PATCH `production_items.actual_qty` (or a session-level total for tubs/bags).
- Show a green `Check` icon inline for 2s after successful save, then fade out.
- Errors: revert value + toast.
- Keeps admin/manager-only permission and existing audit trigger.

---

## Technical Notes

- Migration first (blender table + RAG `actual_updated_by`), then frontend wiring.
- Existing trigger `sync_rag_actual_from_items` stays authoritative — Operator save writes to blender rows and the trigger cascades to RAG, so we don't bypass the audit trail.
- The "Total Produced This Shift" override, when it differs from the blender sum, writes directly to `rag_weekly_entries.actual_qty` AFTER blender writes so the manual number wins.
- No changes to iTouching sync logic; `intouch-sync-production` continues writing to `production_sessions.intouch_good_total` as an independent read-only signal.
