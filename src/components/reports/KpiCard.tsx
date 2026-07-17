import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type KpiAccent =
  | "blue"
  | "indigo"
  | "amber"
  | "green"
  | "red"
  | "purple"
  | "cyan"
  | "muted";

const ACCENT_CLASS: Record<KpiAccent, string> = {
  blue: "border-l-blue-500",
  indigo: "border-l-indigo-500",
  amber: "border-l-amber-500",
  green: "border-l-green-500",
  red: "border-l-destructive",
  purple: "border-l-purple-500",
  cyan: "border-l-cyan-500",
  muted: "border-l-muted-foreground/40",
};

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  sublabel?: ReactNode;
  accent?: KpiAccent;
  loading?: boolean;
  className?: string;
  valueClassName?: string;
}

export function KpiCard({
  label,
  value,
  icon,
  sublabel,
  accent = "blue",
  loading = false,
  className,
  valueClassName,
}: KpiCardProps) {
  return (
    <Card className={cn("border-l-4", ACCENT_CLASS[accent], className)}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        {loading ? (
          <Skeleton className="h-8 w-20 mt-1" />
        ) : (
          <p className={cn("text-3xl font-bold leading-tight", valueClassName)}>
            {value}
          </p>
        )}
        {sublabel && !loading && (
          <p className="text-[10px] text-muted-foreground mt-1">{sublabel}</p>
        )}
      </CardContent>
    </Card>
  );
}
