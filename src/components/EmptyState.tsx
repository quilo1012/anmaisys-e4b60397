import * as React from "react";
import { cn } from "@/lib/utils";
import { Inbox, type LucideIcon } from "lucide-react";

type IconProp = React.ReactNode | LucideIcon;

interface EmptyStateProps {
  icon?: IconProp;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

function renderIcon(icon?: IconProp) {
  if (!icon) {
    return <Inbox className="h-12 w-12" aria-hidden="true" />;
  }
  // Already a rendered React element (e.g. <MyIcon />)
  if (React.isValidElement(icon)) {
    return icon;
  }
  // Component type: either a plain function component or a forwardRef/memo
  // object (lucide icons are forwardRef objects with {$$typeof, render}).
  if (
    typeof icon === "function" ||
    (typeof icon === "object" && icon !== null)
  ) {
    const Icon = icon as React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
    return <Icon className="h-12 w-12" aria-hidden={true} />;
  }
  return null;
}


/**
 * Reusable empty-state block. Renders centered with generous spacing, a muted
 * icon, title, optional description and an optional action (e.g. a Button).
 * Follows the shadcn/tailwind design tokens used across the app.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-12 px-6 gap-3",
        className,
      )}
      role="status"
    >
      <div className="text-muted-foreground/60">{renderIcon(icon)}</div>
      <div className="space-y-1 max-w-md">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export default EmptyState;
