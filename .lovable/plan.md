

# Design System Update — Minimalist Industrial Theme

## Summary

Apply the specified design system: primary color #1978E5, Inter font, light-focused theme, and minimalist styling. Most infrastructure (heatmap, PIN auth, WO tracking) already exists — this is purely a visual/branding update.

## What Already Exists (No Changes Needed)
- Failure heatmap visualization (AnalyticsPage)
- PIN authentication for engineers (EngineerDashboard)
- Work order tracking by engineer
- Border radius already 8px (0.5rem)
- Light/dark theme system

## Changes

### 1. Add Inter Font
- Add Google Fonts import for Inter in `index.html`
- Update `tailwind.config.ts` font-family sans to `['Inter', ...]`

### 2. Update Primary Color to #1978E5
- #1978E5 in HSL ≈ `211 78% 50%`
- Update `--primary` in `:root` and `.dark` in `src/index.css`
- Update `--ring` to match
- Update sidebar colors to complement the new primary

### 3. Light Theme Polish
- Ensure `:root` (light) values use clean whites and subtle grays for a minimalist feel
- Keep dark mode functional but optimize light as default

## Files Modified

| File | Change |
|------|--------|
| `index.html` | Add Inter Google Font link |
| `tailwind.config.ts` | Update fontFamily.sans to Inter |
| `src/index.css` | Update primary, ring, sidebar colors |

