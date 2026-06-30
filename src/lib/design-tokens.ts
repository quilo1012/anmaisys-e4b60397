// src/lib/design-tokens.ts
// AN Brand Design Tokens — centralized constants for Applied Nutrition UI.
// Created as part of the Design System Audit & Standardization.

// ─── Brand Colors ─────────────────────────────────────────────────────────
export const brandColors = {
  primaryBlue: "hsl(211, 78%, 50%)",
  sidebarNavy: "hsl(211, 64%, 33%)",
} as const;

// ─── Status Semantic Colors (HSL values) ─────────────────────────────────
export const statusSemanticColors = {
  success: "hsl(142, 71%, 45%)", // green
  warning: "hsl(43, 96%, 56%)",  // amber
  error: "hsl(0, 84%, 60%)",     // red
  info: "hsl(211, 78%, 50%)",    // blue
  neutral: "hsl(215, 16%, 47%)", // gray
} as const;

// ─── Typography Scale (Tailwind text sizes) ───────────────────────────────
export const typography = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
  "4xl": "text-4xl",
} as const;

// ─── Spacing Constants (Tailwind spacing utilities) ──────────────────────
export const spacing = {
  card: "p-6",
  section: "p-4",
  gap: "gap-6",
} as const;

// ─── Border Radius ─────────────────────────────────────────────────────────
export const borderRadius = {
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.75rem",
} as const;

// ─── Status Badge Token Config ─────────────────────────────────────────────
// Maps common status values to a unified set of Tailwind className strings.
// These are the source-of-truth styles used by the StatusBadge component.
export const statusBadgeConfig = {
  open: "bg-blue-100 text-blue-800 border border-blue-200",
  in_progress: "bg-amber-100 text-amber-800 border border-amber-200",
  completed: "bg-green-100 text-green-800 border border-green-200",
  cancelled: "bg-gray-100 text-gray-800 border border-gray-200",
  pending: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  critical: "bg-red-100 text-red-800 border border-red-200",
  default: "bg-gray-100 text-gray-800 border border-gray-200",
} as const;

export type StatusBadgeVariant = keyof typeof statusBadgeConfig;

// ─── Role Badge Tokens (for reference) ─────────────────────────────────────
export const roleBadgeConfig = {
  admin: "bg-red-100 text-red-800 border border-red-200",
  manager: "bg-purple-100 text-purple-800 border border-purple-200",
  engineer: "bg-blue-100 text-blue-800 border border-blue-200",
  operator: "bg-gray-100 text-gray-800 border border-gray-200",
  default: "bg-gray-100 text-gray-800 border border-gray-200",
} as const;

export type RoleBadgeVariant = keyof typeof roleBadgeConfig;
