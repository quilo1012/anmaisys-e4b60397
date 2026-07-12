## Findings — Downtime Heatmap "Pattern Matrix" visibility (read-only audit)

### 1) Component & data source
- **Component:** `src/pages/dashboard/DowntimeHeatmapPage.tsx` (route `dashboard/downtime-map`). The matrix is rendered inline in this file — the `<Card>` with title "Pattern Matrix" starts at ~line 368 and the `<table>` at ~line 376.
- **Data hook:** `useDowntime()` in `src/hooks/useDowntime.ts`. It merges 3 sources into a unified `DowntimeRecord[]`:
  - `downtime_events` (per-WO stops) joined with `work_orders → lines`
  - `work_orders` rows with `line_stopped_at` populated but no matching event (fallback)
  - `downtime` (manual records)
  Fields used by the matrix: `line`, `started_at`, `ended_at` (open stops treated as `ended_at = now`). Query is capped at last 90 days.
- **Aggregation:** `useMemo` inside `DowntimeHeatmapPage.tsx` (lines ~204–310). Builds `perLineIntervals` keyed by `${weekdayIdx}-${Day|Night}`, then converts to minutes via `unionMinutes` → `unionMs` from `src/lib/downtimeReconcile.ts`.

### 2) How each cell total & color are computed
- **Total (minutes) per cell:** UNION of intervals in that bucket (parallel/overlapping stops on the same line are counted once), then `Math.round(ms/60_000)` with a floor of 1 min for any non-zero interval (`unionMinutes`, lines 124–129).
- **Color scale:** `cellColor(minutes, max)` at lines 139–146 — a **relative** scale using `pct = minutes / grandMax` where `grandMax` is the **single largest cell across the whole matrix** (not a per-line or per-row max, not a percentile, not capped):
  - `<15%` emerald, `<35%` amber, `<65%` orange, `≥65%` red.
- **Why a 7h41 stop can look "similar" to smaller ones:** the scale is dominated by the current `grandMax`. If Line 5 Thu Night = 461 min *is itself* `grandMax`, it renders red — but every other cell shrinks against it, so a 60-min cell becomes emerald (60/461 ≈ 13%). Conversely, if another bucket has an even longer stop, the 7h41 can drop into amber/orange. There is no absolute anchor (e.g. "≥120 min = red"), no per-line normalization, and no outlier cap, so a single very long stop distorts the whole map's contrast.

### 3) Tooltip / cell detail
- Only a native browser `title` attribute on each `<td>` (line 418): `"{line} • {Day} {D|N}: {Xh Ym} ({N} events)"`.
- There is **no** click/hover detail panel, no list of individual stop events, no WO numbers, no start/end times per stop. `count` is the number of events that *started* in that bucket (lines 250–254), not the number of segments; a single overnight stop counts as `1×` even if split across two shifts.

### 4) Cross-midnight / shift-boundary handling
- Correctly split. Lines 232–248 walk each stop with `nextShiftBoundary(cursor)` (from lines 132–137) which returns the next London 06:00 or 18:00 boundary, and each segment is placed in its own `(weekdayIdx, shift)` bucket using `londonAllParts` (Europe/London TZ via `Intl.DateTimeFormat`). So a stop running Thu 22:00 → Fri 07:00 contributes Thu-Night (22:00–Fri 06:00) + Fri-Day (06:00–07:00).
- Weekday derived from London wall-clock parts (lines 238–240), so DST and midnight crossings land on the correct London day.
- Range clamping to `[fromMs, toMs]` also happens before splitting (lines 219–221), so stops overlapping the selected range boundary are trimmed rather than mis-attributed.
- **Caveat (not a bug in split logic):** the event `count` is attributed only to the *start* bucket (lines 250–254). An overnight stop shows `1×` in the shift it started in and `0×` in the next shift, even though minutes appear in both. This is a display choice, not a duration miscalculation.

### Summary of what limits visibility of long stops today
- Relative color scale anchored on `grandMax` with no absolute threshold and no cap → contrast is driven by the single worst cell.
- Only a native `title` tooltip; no drill-down to the underlying WO/manual downtime rows.
- Cell shows aggregated `Xh Ym` and `N×` only; no indication that the total came from one long stop vs many small ones (e.g. no max-single-stop badge).
- No visual marker for "single stop ≥ threshold" (e.g. ≥ 2h) that would make outliers pop regardless of scale.

No code, DB, or config changes were made.