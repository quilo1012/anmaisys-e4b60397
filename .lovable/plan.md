Substituir o arquivo `src/lib/design-tokens.ts` por uma versão completa e tipada com tokens explícitos do design system da Applied Nutrition.

Escopo:
- Cores de status: success, warning, error, info, neutral com hex values exatos.
- Surfaces dark mode: base, surface1, surface2, surface3, surface4.
- Texto: primary, secondary, disabled, muted.
- Borders: subtle, default, strong.
- Brand primary: main, dark, light (sky-500 palette).
- Tipografia: fontFamily, scale (h1-h4, body, caption), weight (regular, medium, semibold, bold).
- Espaçamento: grid 4px (xs a xxxl).
- Border radius: sm, md, lg, xl, full.
- Sombras dark mode: sm, md, lg.
- TypeScript com `as const` para type safety.
- Exportar tipo helper `StatusColor` para as cores de status.
- Não alterar nenhum componente existente.

Arquivos afetados:
- `src/lib/design-tokens.ts` (reescrito).

```typescript
// src/lib/design-tokens.ts
// AN Brand Design Tokens — explicit constants for Applied Nutrition UI.

export const statusColors = {
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  neutral: '#6b7280',
} as const;

export type StatusColor = keyof typeof statusColors;

export const statusColorMap = {
  completed: statusColors.success,
  resolved: statusColors.success,
  ok: statusColors.success,
  normal: statusColors.success,
  in_progress: statusColors.warning,
  pending: statusColors.warning,
  active: statusColors.warning,
  error: statusColors.error,
  low_stock: statusColors.error,
  critical: statusColors.error,
  cancelled_hard: statusColors.error,
  open: statusColors.info,
  info: statusColors.info,
  cancelled: statusColors.neutral,
  unknown: statusColors.neutral,
} as const;

export const surfacesDark = {
  base: '#0a0a0a',
  surface1: '#111111',
  surface2: '#1a1a1a',
  surface3: '#242424',
  surface4: '#2d2d2d',
} as const;

export const textColors = {
  primary: '#f8fafc',
  secondary: '#94a3b8',
  disabled: '#475569',
  muted: '#334155',
} as const;

export const borderColors = {
  subtle: '#1e293b',
  default: '#334155',
  strong: '#475569',
} as const;

export const brandPrimary = {
  main: '#0ea5e9',
  dark: '#0284c7',
  light: '#38bdf8',
} as const;

export const typography = {
  fontFamily: 'Inter, system-ui, sans-serif',
  scale: {
    h1: '2.25rem',
    h2: '1.875rem',
    h3: '1.5rem',
    h4: '1.25rem',
    body: '0.875rem',
    caption: '0.75rem',
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
  xxxl: '48px',
} as const;

export const borderRadius = {
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  full: '9999px',
} as const;

export const shadows = {
  sm: '0 1px 2px rgba(0,0,0,0.5)',
  md: '0 4px 6px rgba(0,0,0,0.4)',
  lg: '0 10px 15px rgba(0,0,0,0.3)',
} as const;
```