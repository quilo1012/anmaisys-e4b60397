
# AN Maintenance – Industrial Maintenance Management System

## Overview
A professional industrial maintenance system with role-based access (Operator, Engineer, Manager), work order tracking, stock/inventory management, and real-time alerts. Built incrementally using Lovable Cloud (Supabase) for backend.

---

## Phase 1 – Authentication & User Management

### Login Page
- Clean industrial-themed login screen (dark blue #1E3A8A, gray, white)
- Email/password authentication with input validation (trim + lowercase email)
- Redirect to role-specific dashboard after login

### First-User Flow
- The very first person to sign up automatically becomes Manager
- Only Managers can create additional users (Operators & Engineers)

### User Management (Manager only)
- Create, edit, activate/deactivate users
- Assign roles: Operator, Engineer, Manager
- Assign shift/schedule to Engineers (for alert targeting)

### Database Tables
- **profiles** – name, email, active status, shift/schedule, created_at
- **user_roles** – separate table linking users to roles (admin/engineer/operator) with RLS security definer functions to prevent privilege escalation

---

## Phase 2 – Work Orders (Core Flow)

### Operator Dashboard (`/dashboard/operator`)
- **Create Work Order** form: Line, Machine, Problem Description
- Status auto-set to "Open", timestamp recorded automatically
- List of own WOs only (filtered by operator_id)

### Engineer Dashboard (`/dashboard/engineer`)
- View all open Work Orders
- **Start** a WO → status changes to "In Progress", engineer_id assigned
- **Finish** a WO → status changes to "Completed", close timestamp and total time recorded
- Real-time sound alert + visual notification when a new WO is created (only if logged in and on current shift)

### Manager Dashboard (`/dashboard/manager`)
- View ALL Work Orders across all statuses
- Force-close any WO if needed
- Full visibility of who created and who executed each WO

### Work Order Detail Page (`/dashboard/wo/:id`)
- Full details: line, machine, description, status, timestamps
- Action history / timeline
- Parts used (Phase 3)

### Database
- **work_orders** table with status enum, operator/engineer references, timestamps
- Supabase Realtime subscriptions for live WO updates and engineer alerts
- **notified_engineers** tracking array

---

## Phase 3 – Stock & Inventory

### Stock Page (`/dashboard/stock`)
- List all parts with current quantity, minimum threshold, category (BFM, spare, consumable)
- Visual alert when stock falls below minimum
- Manager-only: manual stock adjustments

### Parts Usage (Engineer)
- When finishing a WO, engineers register parts used
- Stock automatically decreases based on usage
- Parts usage history linked to each WO

### Database
- **products** – part name, code, current quantity, minimum stock, category
- **parts_used** – links WO to product with quantity and engineer

---

## Phase 4 – Reports & Dashboard

### Manager Reports
- Export Work Orders to CSV/PDF
- Filter by date range, status, line, machine
- Summary statistics: total WOs, avg resolution time, parts consumption

### Manager Dashboard Overview
- KPI cards: Open WOs, In Progress, Completed today
- Charts: WOs over time, avg response time, top machines with issues
- Stock alerts summary

---

## Design & UX
- **Industrial theme**: Dark blue (#1E3A8A) header/sidebar, clean white content area, gray accents
- **Responsive**: Desktop-first with mobile-friendly layout
- **Navigation**: Role-based sidebar showing only permitted sections
- **Catch-all route**: Redirects unauthenticated users to `/login`
- **Sound alerts**: Browser audio notification for engineers on new WOs

---

## Security
- Row-Level Security (RLS) on all tables
- Roles stored in separate `user_roles` table (not on profiles) with security definer functions
- Operators can only see their own WOs
- Engineers can only act on WOs during their shift
- Only Managers can manage users, adjust stock, and access reports
