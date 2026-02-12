

# Top 5 Problems Chart + Problem Filter + Role Security Verification

## 1. Top 5 Problems Chart

Add a new bar chart next to the existing "Top 5 Machines" chart showing the most frequent problem descriptions across all WOs.

**File:** `src/pages/dashboard/ManagerDashboard.tsx`

- Add a `topProblems` useMemo that aggregates `allWOs` by `description` field, counts occurrences, sorts descending, and takes top 5
- Add a third chart card in the charts grid (change from `md:grid-cols-2` to `lg:grid-cols-3` or stack the third below)
- Use a horizontal `BarChart` (same style as Top 5 Machines) with `description` on Y-axis and `count` on X-axis

## 2. Problem Description Filter on WO Table

Add a dropdown filter next to the existing Status filter to filter WOs by problem description.

**File:** `src/pages/dashboard/ManagerDashboard.tsx`

- Add state: `const [problemFilter, setProblemFilter] = useState<string>("all")`
- Add a `Select` component next to the Status filter with options from `problemDescriptions` list + "All Problems" default
- Update the `filteredWOs` useMemo to also filter by `problemFilter` when not "all" (match against `wo.description`)

## 3. Role Change Security (Already Implemented)

The system already restricts role changes to managers only:
- The `update-user` edge function checks `has_role(caller.id, 'admin')` before allowing any updates
- The `user_roles` table has RLS policies: only admins can INSERT, UPDATE, or DELETE roles
- The ManageUsers page is behind `ProtectedRoute` with `allowedRoles={['admin']}`

No changes needed -- the security is already in place at both the edge function level and database RLS level.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/dashboard/ManagerDashboard.tsx` | Add Top 5 Problems chart + Problem Description filter dropdown |

## Technical Details

### Top 5 Problems useMemo
```text
const topProblems = useMemo(() => {
  if (!allWOs) return [];
  const counts: Record<string, number> = {};
  allWOs.forEach(w => { counts[w.description] = (counts[w.description] || 0) + 1; });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([problem, count]) => ({ problem, count }));
}, [allWOs]);
```

### Problem Filter in filteredWOs
Add condition inside the existing `filteredWOs` useMemo:
```text
if (problemFilter !== "all") {
  filtered = filtered.filter(w => w.description === problemFilter);
}
```

