import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { Users, Contact, CalendarDays, Clock, Calculator, HandCoins, UserCog } from "lucide-react";

/**
 * The screens that are all about the same people, joined at the top.
 *
 * They were separate sidebar rows — Headcount, Leave, Attendance, Finance Close —
 * which put four entries in a menu for what is one job seen from four angles: who is
 * in today, who is off, who clocked on, and what that costs. The board is where
 * somebody starts, so the others hang off it. Employee joined them when the Workforce
 * screen was retired, since the records it held feed all of the others. It is reachable
 * only from here — it was on the System Hub too, which put the same screen in two
 * places and made the hub look like the way in when the board is.
 *
 * Routes are unchanged, so a bookmark or a link from another screen still lands where
 * it did. Only the way in moved.
 */
const TABS = [
  { to: "/dashboard/headcount", label: "Board", icon: Users },
  { to: "/dashboard/people", label: "Employee", icon: Contact },
  { to: "/dashboard/leave", label: "Annual Leave", icon: CalendarDays },
  { to: "/dashboard/attendance", label: "Attendance", icon: Clock },
  { to: "/dashboard/overtime", label: "Overtime", icon: HandCoins },
  { to: "/dashboard/finance-close", label: "Finance Close", icon: Calculator },
  { to: "/users/manage", label: "User Management", icon: UserCog },
];

export function WorkforceTabs() {
  const { can } = useRole();
  const visibleTabs = TABS.filter((t) => can(
    t.to === "/dashboard/people" ? "employees.view" :
    t.to === "/dashboard/headcount" ? "headcount.view" :
    t.to === "/dashboard/overtime" ? "overtime.manage" :
    t.to === "/users/manage" ? "users.manage" : "workforce.view",
  ));
  return (
    <nav
      aria-label="Workforce sections"
      className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1 print:hidden"
    >
      {visibleTabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) =>
            cn(
              // 36px and the whole pill: this sits above a board used on a tablet.
              "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )
          }
        >
          <t.icon className="h-3.5 w-3.5" />
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
