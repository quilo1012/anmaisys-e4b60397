// src/lib/design-tokens.ts
// AN Brand Design Tokens — explicit constants for Applied Nutrition UI.

// ─── Status Colors ─────────────────────────────────────────────────────────
export const statusColors = {
  success: "#22c55e", // green - completed, resolved, ok, normal
  warning: "#f59e0b", // yellow - in_progress, pending, active
  error: "#ef4444", // red - error, low_stock, critical, cancelled_hard
  info: "#3b82f6", // blue - open, info
  neutral: "#6b7280", // gray - cancelled, unknown
} as const;

export type StatusColor = keyof typeof statusColors;

// ─── Surfaces (Dark Mode) ──────────────────────────────────────────────────
export const surfacesDark = {
  base: "#0a0a0a",
  surface1: "#111111",
  surface2: "#1a1a1a",
  surface3: "#242424",
  surface4: "#2d2d2d",
} as const;

// ─── Text Colors ───────────────────────────────────────────────────────────
export const textColors = {
  primary: "#f8fafc",
  secondary: "#94a3b8",
  disabled: "#475569",
  muted: "#334155",
} as const;

// ─── Border Colors ─────────────────────────────────────────────────────────
export const borderColors = {
  subtle: "#1e293b",
  default: "#334155",
  strong: "#475569",
} as const;

// ─── Brand Primary ─────────────────────────────────────────────────────────
export const brandPrimary = {
  main: "#0ea5e9", // sky-500
  dark: "#0284c7",
  light: "#38bdf8",
} as const;

// ─── Typography ────────────────────────────────────────────────────────────
export const typography = {
  fontFamily: "Inter, system-ui, sans-serif",
  scale: {
    h1: "2.25rem",
    h2: "1.875rem",
    h3: "1.5rem",
    h4: "1.25rem",
    body: "0.875rem",
    caption: "0.75rem",
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

// ─── Spacing (4px grid) ────────────────────────────────────────────────────
export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  xxl: "32px",
  xxxl: "48px",
} as const;

// ─── Border Radius ─────────────────────────────────────────────────────────
export const borderRadius = {
  sm: "4px",
  md: "6px",
  lg: "8px",
  xl: "12px",
  full: "9999px",
} as const;

// ─── Shadows (Dark Mode) ───────────────────────────────────────────────────
export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,0.5)",
  md: "0 4px 6px rgba(0,0,0,0.4)",
  lg: "0 10px 15px rgba(0,0,0,0.3)",
} as const;

// ─── Legacy Status Badge Config (kept for StatusBadge.tsx compatibility) ─────
export const statusBadgeConfig = {
  open: "bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
  in_progress: "bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800",
  completed: "bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800",
  cancelled: "bg-gray-100 text-gray-800 border border-gray-200 dark:bg-gray-800/60 dark:text-gray-300 dark:border-gray-700",
  pending: "bg-yellow-100 text-yellow-800 border border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-800",
  critical: "bg-red-100 text-red-800 border border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
  success: "bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800",
  warning: "bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800",
  error: "bg-red-100 text-red-800 border border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
  info: "bg-blue-100 text-blue-800 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
  low_stock: "bg-red-100 text-red-800 border border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
  normal: "bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800",
  default: "bg-gray-100 text-gray-800 border border-gray-200 dark:bg-gray-800/60 dark:text-gray-300 dark:border-gray-700",
} as const;

export type StatusBadgeVariant = keyof typeof statusBadgeConfig;
