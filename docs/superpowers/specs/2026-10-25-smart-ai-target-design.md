# Smart AI Target — design

Status: draft for approval · 25/10/2026

## Intent

The shift target (`rag_weekly_entries.plan_qty`) is typed by hand on RAG Weekly. When it
is too high the line is red all shift and people stop looking at the board; when it is
too low it asks nothing of the line. Smart AI Target gives the planner a **suggested**
target per line and shift, built from what that line has actually made, with a reason a
person can check in one line.

Who it serves: the planner, on RAG Weekly. (Confirmed by the user's "ok" to the playback
on 25/10; everything else in this section is the agent's proposal.)

## Goals

1. A suggested target per line × shift × date, next to the planner's figure on RAG Weekly.
2. A one-line reason under each suggestion, made only of numbers the screen can show
   (e.g. "COLMAR on Line 1: 6,900 median over 11 shifts · 8 people today vs 9 usual").
3. One action: **Use suggestion** copies it into `plan_qty`. The planner can still type
   anything.
4. A learning record: every suggestion is stored, and scored against the actual when the
   shift closes, so accuracy is visible week by week.

## Non-goals

- No automatic writes to `plan_qty`. Ever.
- No operator-facing change. Line screens keep reading `plan_qty` exactly as today.
- No per-SKU standard rates (`sku_products.target_per_hour`) as an input — 208 active SKUs
  hold 0 and the rest hold line-class defaults.
- No iTouching counts as an input (`intouch_qty` has always been NULL; sync is off).
- No machine-learning model training in phase 1.

## Anti-goals (failure even if it "works")

- A suggestion that silently becomes the target. `calculate-shift-targets` did exactly this
  on 08/08 and set two lines to zero; that history is in its header comment.
- A zero standing in for "not enough data". No history ⇒ no suggestion, shown as "—".
- A number nobody can reproduce. If the reason line cannot explain it, it is not shown.
- An LLM inventing the number.

## Constraints

- Stack stays as is: Supabase Postgres + React. No new service.
- Database changes ship as SQL pasted into Lovable's SQL editor; the agent cannot apply
  them. Edge functions ship through a Lovable deploy. Probe production before and after.
- Line names are free text on `production_sessions` and `rag_weekly_entries`; match with
  the normalised rule already used by `rag_actual_from_floor`.
- Actuals are operator-logged only from 30/07/2026 (`rag_actual_is_derived`). Older RAG
  actuals are partly hand-typed; the model uses **30/07 onwards only**.
- Permissions go through `can()` / `has_action`; reuse the existing `smarttarget.view`
  action and add `smarttarget.apply` for the button, granted to admin, manager and
  production_office_admin — the same people who can edit the RAG plan today (user, 25/10).

## How the number is made (agent's call — statistics, not AI)

For a line L, shift S, date D, with the SKUs planned for that shift (`production_items`
of the session, else the iTouching scheduled jobs the planner imports):

1. **Line output per shift** from `production_sessions` × `production_items` since 30/07:
   total `actual_qty` per (line, date, shift). Keep shifts with actual > 0.
2. **Comparable shifts**: same line, same shift type, last 8 weeks. If ≥ 50% of the
   planned SKUs ran on a comparable shift, weight it ×2.
3. **Base** = median of comparable shifts (median, not mean: one shift with a breakdown
   should not drag the target).
4. **Headcount factor** = people allocated to the line today (`daily_allocations` via
   `headcount_areas.line_id`) ÷ median people on the comparable shifts, clamped 0.8–1.1.
   Skipped when either side is unknown.
5. **No carry-over.** The user decided (25/10): a missed shift does not raise the next
   suggestion (7,000 usual, 1,000 short last night ⇒ still 7,000). The old
   `compute_smart_target` added half the shortfall; that rule is dropped, not hidden.
6. **Minimum evidence**: fewer than 5 comparable shifts ⇒ no suggestion.
7. Suggested = round(base × headcount factor) to the nearest 10.

Not used, with reason: overdue-PM penalty (`pm_schedules` is empty, so it is always 0);
`sku_production_history.units_per_hour` (its `run_minutes` gives every SKU the whole
shift, so multi-SKU shifts read slow).

## Where AI is used (agent's call)

Only to turn the numbers above into the reason sentence, through the existing Lovable AI
gateway (same pattern as `analyze-sku-performance`), and only from numbers passed in.
If the gateway fails, the screen shows a plain template sentence built in code. The
feature must be fully usable with AI switched off.

## Data

- **`prediction_log`** (exists, unused since SmartTargetPage was deleted 28/07): one row per
  suggestion. Use `predicted_target`, `applied_target` (set by Use suggestion), `notes`
  (jsonb: base, factors, comparable-shift count, method version). Its trigger
  `resolve_prediction_from_rag` already scores it when the RAG actual lands — verify the
  trigger is live in production before relying on it.
- **New SQL function** `suggest_shift_target(date, line, shift) returns jsonb` (security
  definer, read-only, granted to authenticated, gated by `has_action('smarttarget.view')`).
  Supersedes `compute_smart_target`, which stays untouched until the new one is proven.
- **Writing suggestions**: computed on screen open for the visible week and upserted into
  `prediction_log` (unique on date, line, shift) — no new cron.

## Screens

- **RAG Weekly**: a "Suggested" figure beside each plan cell, the reason line on hover/tap,
  and a **Use suggestion** button for holders of `smarttarget.apply`. "—" when there is not
  enough history.
- **Weekly Production Report** (exists, unrouted): re-route it as the accuracy view —
  suggestion vs plan vs actual per line per week, and how often the planner used it.

## Phases

0. **Data check (read-only, needs user's go-ahead).** Counts only: shifts with operator
   actuals since 30/07 per line; whether `prediction_log` has rows and its trigger is enabled;
   headcount coverage per line. Decide whether every line clears the 5-shift minimum.
1. SQL function + tests on local Postgres (the repo's established method).
2. RAG Weekly suggestion column, read-only (no button) — run 2 weeks, compare to plans.
3. Use suggestion button + accuracy page.
4. AI-written reason line.

## Left to the builder

Exact placement and styling inside RAG Weekly; query batching for a week of cells; the
template wording for the fallback reason.

## Phase-0 results (29/10, production, read-only, admin session)

- Operator-logged shifts since 30/07: 43–83 per line/shift for Lines 1–6 and Tablet Line
  DAY; GEL Line 24; Gel Machine 6, Gel Packing 1, Tablet Line NIGHT 2. Shift-to-shift spread
  is wide (coefficient of variation 17–53%).
- `production_sessions.staff_actual` is almost never filled (0–4 shifts per line); the
  Headcount board covers 40–83 days per line/shift, so headcount must come from there.
- `prediction_log`: 2 rows, latest 28/06. The scoring trigger cannot be read over REST.
- **Backtest, 816 shifts:** the RAG plan was within a median **4%** of the actual; the
  8-week line median (step 3 above) was off by a median **23%**. Restricted to the 142
  plans whose row existed before the shift started: plan 6%, median 25%.
- **Most plans are entered late:** of 904 RAG rows with a plan since 30/07, 154 were created
  before the shift started, 319 during it and 431 after it ended. October: 11 of 292 before.
  Plan edits are not audited, so a row created early may still have been changed later.

Consequence: as designed, the suggestion would be about five times less accurate than the
figure it sits next to. Either the plan is genuinely good (it follows the job quantity), or
it is being written to match the result — the data cannot tell which until the target is
frozen at shift start. The design is on hold pending the user's choice of direction.

## Decided by the user (25/10)

- Carry-over: off.
- Use suggestion: admin, manager, production office.
- Phase-0 counts on production: approved, read-only, counts only.
