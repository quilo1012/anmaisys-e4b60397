

User wants to audit `.map()` calls that render lists in WorkOrdersPage and MachinesPage and ensure each child has a stable `key` prop. Missing keys cause React reconciliation warnings and subtle re-render bugs.

Let me search both files for `.map(` to enumerate every call site.
<lov-tool-use id="toolu_vrtx_01YQ1gCHKskvBxSxxDUVozX1" name="code--search_files" integration-id="code" data="{\"query\": \"\\\\.map\\\\(\", \"include_patterns\": \"src/pages/dashboard/WorkOrdersPage.tsx,src/pages/dashboard/MachinesPage.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01W64SjQFtjA4ieu83iufEmJ" name="code--search_files" integration-id="code" data="{\"query\": \"\\\\.map\\\\(\", \"include_patterns\": \"src/pages/dashboard/WorkOrdersPage.tsx,src/pages/dashboard/MachinesPage.tsx\"}">
</lov-tool-use>
All `.map()` calls in both files already include `key` props. Let me verify the truncated portion of WorkOrdersPage and the kanban columns area.
<lov-tool-use id="toolu_vrtx_01J3cXKZTD2pmWrxq7eiH5JL" name="code--view" integration-id="code" data="{\"file_path\": \"src/pages/dashboard/WorkOrdersPage.tsx\", \"lines\": \"607-730\"}">
</lov-tool-use>
All `.map()` calls in both `WorkOrdersPage.tsx` and `MachinesPage.tsx` already have proper `key` props (using `m.id`, `pd.id`, `l.id`, `wo.id`, `col.key`, `o.value`, `s`, `key`, `line` — all unique and stable).

<lov-plan>

## Finding

I checked every `.map()` call in `src/pages/dashboard/WorkOrdersPage.tsx` and `src/pages/dashboard/MachinesPage.tsx`. **All of them already have proper `key` props.**

### Inventory

**MachinesPage.tsx** (4 mappings, all keyed):
- Status options → `key={o.value}`
- Lines select → `key={l.id}`
- Side buttons → `key={s}`
- Machines table rows → `key={m.id}`

**WorkOrdersPage.tsx** (10 mappings, all keyed):
- Column visibility set init → not JSX (no key needed)
- WO ids list → not JSX (no key needed)
- Kanban cards → `key={wo.id}`
- Date range buttons → `key={key}`
- Engineer perf array → not JSX (no key needed)
- Column toggle checkboxes → `key={col.key}`
- Lines / Problems / Machines select items → `key={line}`, `key={pd.id}`, `key={m.id}`
- Paginated table rows → returns rows with `key={wo.id}` (verified earlier)
- Edit-dialog Select items → `key={m.id}`, `key={pd.id}`

### No changes needed

There is nothing to fix in these two files. If you've seen a "missing key" warning in the console, it's coming from a different file. Likely candidates worth checking next:

- `src/pages/dashboard/EngineerDashboard.tsx` (large WO + checklist + photo lists)
- `src/pages/dashboard/OperatorDashboard.tsx` (insights + machine suggestions)
- `src/pages/dashboard/AnalyticsPage.tsx` (chart legends, ranking lists)
- `src/pages/dashboard/ControlCenterPage.tsx` (zone + machine grids)
- `src/components/WoTimeline.tsx`, `src/components/NotificationPanel.tsx`

Tell me which file is throwing the warning (or paste the console message) and I'll target the exact `.map()`.

