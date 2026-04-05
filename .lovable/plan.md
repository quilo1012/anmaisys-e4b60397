

# Create Demo Review Setup via Seed Edge Function

## Approach

Create a `seed-demo` edge function that an admin can invoke once to populate the system with demo-safe data. This keeps production auth untouched and uses existing infrastructure (create-user pattern, engineers table, etc.).

## What gets created

| Entity | Details |
|--------|---------|
| Demo Manager user | `demo.manager@appliednutrition.uk` / `DemoPass123!` / role: admin |
| Demo Engineer user | `demo.engineer@appliednutrition.uk` / `DemoPass123!` / role: engineer |
| Demo Engineer identity | "Demo Engineer" in `engineers` table with PIN `1234` (bcrypt hashed) |
| Problem descriptions | 2 sample problems with checklists attached |
| Checklist items | 3 items per problem (mix of required/optional, safety/quality types) |
| Work Orders | 3 sample WOs in different statuses (open, in_progress, completed) with real timestamps, engineer assignment, and signed_by_name |
| Parts Used | 2 records linked to completed WO, referencing existing products |

## Files

### 1. `supabase/functions/seed-demo/index.ts` (new)

- Admin-only edge function (checks `has_role`)
- Idempotent: checks if demo data already exists before creating
- Creates demo users via `supabase.auth.admin.createUser`
- Inserts engineer identity with hashed PIN
- Creates problem descriptions, checklists, work orders, parts_used
- Returns summary of what was created

### 2. `src/pages/dashboard/ManagerDashboard.tsx` (minor addition)

- Add a "Seed Demo Data" button (visible only in preview/dev environment)
- Calls `supabase.functions.invoke("seed-demo")`
- Shows toast with results
- Button checks `window.location.hostname` to only show on lovable preview domains

## Key details

- Demo engineer PIN: `1234` — allows testing the full PIN verification flow
- Demo credentials shown in a toast after seeding so the reviewer knows them
- The completed WO will have full timeline data (created_at, received_at, arrived_at, started_at, finished_at, signed_by_name) making it printable
- Uses existing machines and products from the DB (fetched dynamically in the edge function)
- No changes to auth flow, RLS policies, or existing user data

