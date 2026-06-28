import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Standardized responsive wrappers for dialog content.
 * Mobile (<640) → full-bleed 95vw, compact paddings.
 * Tablet (≥640) → max-w-lg, comfortable paddings.
 * Desktop (≥1024) → max-w-xl with airier spacing.
 *
 * Centralizing the breakpoints here keeps every dialog visually consistent
 * and makes responsive behavior testable in isolation.
 */
export const dialogContentResponsive =
  "w-[95vw] max-w-lg lg:max-w-xl max-h-[90vh] overflow-y-auto p-4 sm:p-6 lg:p-8";

export const dialogTitleResponsive =
  "text-lg sm:text-xl lg:text-2xl flex items-center gap-2";

export const dialogBodyResponsive = "space-y-3 sm:space-y-4 lg:space-y-5";

export const dialogFooterResponsive =
  "flex-col-reverse sm:flex-row gap-2 sm:gap-3";

export const dialogFieldLabelResponsive = "text-sm sm:text-base";

export const dialogControlResponsive =
  "h-11 sm:h-12 lg:h-12 text-base sm:text-lg";

export const dialogPrimaryActionResponsive =
  "h-11 sm:h-12 w-full sm:w-auto";

interface ShellProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function ResponsiveDialogBody({ children, className, ...rest }: ShellProps) {
  return (
    <div className={cn(dialogBodyResponsive, className)} {...rest}>
      {children}
    </div>
  );
}
