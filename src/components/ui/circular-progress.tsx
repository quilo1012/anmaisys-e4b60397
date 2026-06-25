import { cn } from "@/lib/utils";

interface CircularProgressProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** Override color: success | warning | destructive | primary (default by value) */
  color?: "success" | "warning" | "destructive" | "primary" | "auto";
  label?: string;
  sublabel?: string;
}

/**
 * Animated SVG circular progress. RAG colors auto by value:
 *  >=100% green, >=80% amber, else red.
 */
export function CircularProgress({
  value,
  size = 96,
  strokeWidth = 8,
  className,
  color = "auto",
  label,
  sublabel,
}: CircularProgressProps) {
  const clamped = Math.max(0, Math.min(value, 150));
  const ringPct = Math.min(clamped, 100);
  const radius = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * radius;
  const dash = (ringPct / 100) * c;

  const resolved =
    color !== "auto"
      ? color
      : clamped >= 100
      ? "success"
      : clamped >= 80
      ? "warning"
      : "destructive";

  const stroke =
    resolved === "success"
      ? "hsl(142 76% 36%)"
      : resolved === "warning"
      ? "hsl(38 92% 50%)"
      : resolved === "destructive"
      ? "hsl(0 84% 60%)"
      : "hsl(var(--primary))";

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          style={{ transition: "stroke-dasharray 600ms ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-xl font-bold leading-none">{label ?? `${Math.round(clamped)}%`}</div>
        {sublabel && <div className="text-[10px] text-muted-foreground mt-0.5">{sublabel}</div>}
      </div>
    </div>
  );
}
