import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Users, Contact, CalendarDays, Clock, Calculator } from "lucide-react";

/**
 * The screens that are all about the same people, joined at the top.
 *
 * They were separate sidebar rows — Headcount, Leave, Attendance, Finance Close —
 * which put four entries in a menu for what is one job seen from four angles: who is
 * in today, who is off, who clocked on, and what that costs. The board is where
 * somebody starts, so the others hang off it. People joined them when the Workforce
 * screen was retired, since the employee records it held feed all of the others.
 *
 * Routes are unchanged, so a bookmark or a link from another screen still lands where
 * it did. Only the way in moved.
 */
const TABS = [
  { to: "/dashboard/headcount", label: "Board", icon: Users },
  { to: "/dashboard/people", label: "People", icon: Contact },
  { to: "/dashboard/leave", label: "Leave", icon: CalendarDays },
  { to: "/dashboard/attendance", label: "Attendance", icon: Clock },
  { to: "/dashboard/finance-close", label: "Finance Close", icon: Calculator },
];

export function WorkforceTabs() {
  return (
    <nav
      aria-label="Workforce sections"
      className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1 print:hidden"
    >
      {TABS.map((t) => (
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
