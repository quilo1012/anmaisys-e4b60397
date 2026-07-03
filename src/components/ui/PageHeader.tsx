import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, icon, actions, badge, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-6 gap-3 flex-wrap", className)}>
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="p-2 rounded-lg bg-muted flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-foreground truncate">{title}</h2>
            {badge}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export default PageHeader;
