

# Refactor Machine Form — Flexible Combobox Inputs

## Summary

Replace rigid dropdowns for Machine Type and Location with combobox components that support both selection from existing values and free-text entry. Add validation, logical field grouping, and improved status options.

## Approach

### 1. Create Reusable Combobox Component

Create `src/components/ComboboxInput.tsx` — a Popover + Command-based input that:
- Shows a text input the user can type into freely
- Displays filtered suggestions from a list as the user types
- Allows selecting a suggestion OR keeping custom typed value
- Uses existing Shadcn `Popover`, `Command` components

### 2. Update `useMachines.ts`

- Change `MACHINE_TYPES` and `LOCATIONS` to be default suggestions (not restrictions)
- Add a hook `useDistinctMachineValues()` that queries existing machines to extract unique `machine_type` and `current_location` values — these become dynamic suggestions merged with defaults
- Update status options: `active`, `in_use`, `maintenance`, `idle`

### 3. Refactor `MachinesPage.tsx` Form

Replace the form section with logically grouped fields:

**General Info group:**
- Name (required text input)
- Code (text input, placeholder "MCH-001")

**Classification group:**
- Machine Type → ComboboxInput (required, suggestions from defaults + existing DB values)
- Status → Select dropdown (Active, In Use, Maintenance, Idle)

**Location group:**
- Current Location → ComboboxInput (required, suggestions from defaults + existing DB values)
- Line → Select dropdown (Line 1, Line 2, Line 3)
- Sector → Text input (free text, placeholder "e.g. Packaging")

**Validation on submit:**
- Name required
- Machine Type required
- Location required
- Code uniqueness check (client-side against loaded machines)

### 4. Move Dialog Location Field

Update the Move dialog's location selector to also use the ComboboxInput instead of a fixed dropdown.

## Files Modified

| File | Change |
|------|--------|
| `src/components/ComboboxInput.tsx` | NEW — reusable combobox with free-text + suggestions |
| `src/hooks/useMachines.ts` | Add `useDistinctMachineValues` hook, update status options |
| `src/pages/dashboard/MachinesPage.tsx` | Replace dropdowns with combobox, group fields, add validation |

## Sequence
1. Create ComboboxInput component
2. Update hooks with dynamic suggestions
3. Refactor MachinesPage form layout and validation

