

## Audit Result: Implementation Is Correct

I reviewed all four files end-to-end against the live hook signatures, RLS policies, and React rules. **No syntax errors, no broken JSX, no missing imports, no malformed providers.** The code compiles and the operator flow is fully line-locked by tablet.

### Verification checklist

| Concern | Status |
|---|---|
| `DeviceLineContext` provider/consumer | ✅ Correct (`createContext` + typed `useContext` with throw-on-misuse) |
| `OperatorLineGuard` 3-state machine (loading / unpaired / paired) | ✅ All three branches return valid JSX |
| Imports resolve | ✅ `useDeviceLine`, `getDeviceToken`, `useLines`, `DeviceLineProvider`, `useAuth` — all exist |
| Banner renders only when paired | ✅ Inside `DeviceLineProvider`, above `{children}` |
| `OperatorDashboard` wraps content in guard | ✅ `<OperatorLineGuard><OperatorDashboardContent/></OperatorLineGuard>` |
| `LinePicker` removed from operator form | ✅ Replaced by `MobileAssetSubPicker` (sealer/printer line only) |
| `lineId` sourced from context, not local state | ✅ `const { lineId, lineName } = useDeviceLineCtx()` |
| `useWorkOrders({ lineId })` matches hook signature | ✅ Hook accepts `{ lineId?: string \| null }` and applies `.eq("line_id", …)` |
| `createWO.mutateAsync({ line_id: lineId, … })` matches mutation signature | ✅ Mutation accepts `line_id` and strips empty FKs |
| RLS server-side enforcement | ✅ `Operators create WOs on device line` policy requires `line_id = current_device_line()` |
| Submit Request still works | ✅ `handleSubmit` always uses `lineId` from context, payload shape matches mutation |
| Unpaired tablet blocked | ✅ Returns setup card; children never render → `useDeviceLineCtx` never throws |
| Manual line switching impossible | ✅ No state, no picker, no input — UI exposes only mobile-asset sub-picks |

### Minor observations (not bugs, not blockers)

1. **WO table "Line" column** still reads `machines.find(m => m.name === wo.machine)?.line` — for the rare retroactive case where `machine` is empty this will show "—". Acceptable; the locked banner already makes the line obvious.
2. **`useLines()` call inside the guard** is only used for name lookup; cached query, no perf concern.
3. **`useDeviceLine`** auto-registers an unpaired row on first call — ensures the admin's Devices page sees the token immediately. Already correct.

### Files reviewed (no changes needed)

- `src/contexts/DeviceLineContext.tsx` — clean
- `src/components/OperatorLineGuard.tsx` — clean
- `src/components/MobileAssetSubPicker.tsx` — clean
- `src/pages/dashboard/OperatorDashboard.tsx` — clean

### Confirmation

The operator flow is correctly **line-locked by tablet**:
- Unpaired tablet → blocked, token displayed
- Paired tablet → banner shown, all reads scoped to `lineId`, all WO inserts carry `line_id = device line`
- Server-side RLS enforces the same constraint, so client tampering cannot leak across lines

**No fixes required.** Switch to default mode to apply changes only if you want me to address any of the minor observations above.

