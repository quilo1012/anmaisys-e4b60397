import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { dashboardPathFor, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useContext } from "react";
import { InShellContentContext } from "@/components/shell/shellTitle";

/**
 * Back, in the same place on every screen.
 *
 * Most screens had no way back at all — you either used the browser button, which
 * an operator on a kiosk tablet does not have, or went hunting in the menu. The few
 * that did have one put it wherever the page happened to allow.
 *
 * Two details it gets right that a bare `navigate(-1)` does not:
 * - Opened in a new tab (the printer button does exactly that), there is no history
 *   to go back to, and `navigate(-1)` leaves the person on a dead screen. It falls
 *   back to their own dashboard.
 * - On that dashboard it renders nothing, because there is nowhere above it.
 */
export function BackButton({ className, iconOnly = false }: { className?: string; iconOnly?: boolean } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { role } = useAuth();
  const home = dashboardPathFor(role as Role | null);
  const duplicate = useContext(InShellContentContext);

  if (location.pathname === home) return null;
  // The shell's bar has one already; see InShellContentContext.
  if (duplicate) return null;

  // React Router marks the first entry of a session "default" — that is the
  // new-tab / pasted-link case, where there is nothing behind us.
  const hasHistory = location.key !== "default";

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Go back"
      className={cn("h-9 shrink-0 gap-1.5 px-2 text-muted-foreground hover:text-foreground", className)}
      onClick={() => (hasHistory ? navigate(-1) : navigate(home))}
    >
      <ArrowLeft className="h-5 w-5 sm:h-4 sm:w-4" />
      {!iconOnly && <span className="hidden sm:inline text-sm">Back</span>}
    </Button>
  );
}

export default BackButton;
