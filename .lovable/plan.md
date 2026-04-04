

# Improve Work Order Print/PDF with Logo Watermark

## What's changing

### 1. Add Applied Nutrition symbol as print-only background watermark
- Extract/create a simplified AN symbol (the "AN" monogram from `appliedlogo.jpeg`) as an SVG or use the existing logo image
- Add a print-only watermark element: centered on page, large size (~300px), very low opacity (8-12%), behind all content
- Use CSS `print:block` + `position: fixed` + `z-index: -1` + `opacity: 0.08` so it appears softly in print but is `hidden` on screen

### 2. Ensure all print fields use real saved data only
- Already mostly correct from prior fixes
- Double-check no remaining `"—"` in any print-visible field (line 364 cost breakdown has one but is `print:hidden` so OK)

### 3. Keep existing correct behavior
- Single template in `WorkOrderDetail.tsx` for both roles
- Engineer/Operator signature sections preserved
- Parts Used uses `pu.engineer?.name || wo.engineer_name || ""`
- Print CSS hides sidebar, nav, buttons, chat, photos, costs

## Technical approach

**File: `src/pages/dashboard/WorkOrderDetail.tsx`**

Add a print-only watermark div inside `#wo-print-content`, positioned as a fixed background element:

```tsx
{/* Print-only watermark */}
<div className="hidden print:block fixed inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: -1 }}>
  <img src={appliedLogo} alt="" className="w-72 h-72 object-contain opacity-[0.08]" />
</div>
```

**File: `src/index.css`**

Add print rule to ensure the watermark container renders correctly:
```css
.print-watermark {
  display: none !important;
}
@media print {
  .print-watermark {
    display: flex !important;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: -1;
    pointer-events: none;
  }
}
```

Since we only have the full `appliedlogo.jpeg` (which likely includes text), and the user wants **only the symbol/icon part**, we'll use CSS techniques (clip or sizing) to show just the icon portion, or use the full logo at very low opacity where the symbol dominates visually. Given we can't edit the image file, we'll use the logo at ~8% opacity which makes any text nearly invisible while the symbol shape remains visible as a watermark.

## Files modified

| File | Change |
|------|--------|
| `src/pages/dashboard/WorkOrderDetail.tsx` | Add print-only watermark element using the logo |
| `src/index.css` | Add `.print-watermark` CSS class for print positioning |

