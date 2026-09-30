import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onWheel, ...props }, ref) => {
    /**
     * A number input changes its value when the wheel turns over it, and several
     * of the screens that use one save on blur — the weekly plan, the shift
     * history, the daily target. So a manager scrolling a long page with the
     * cursor resting on a field silently rewrote a production number and it was
     * persisted. Blurring on wheel takes the field out of the scroll's way
     * without swallowing the scroll itself.
     */
    const guardWheel: React.WheelEventHandler<HTMLInputElement> = (e) => {
      if (type === "number") e.currentTarget.blur();
      onWheel?.(e);
    };
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 coarse:h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        autoComplete="off"
        onWheel={guardWheel}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
