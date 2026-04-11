

# Fix: Work Order Print Layout

## Root Cause
The recent sidebar tablet fix added `h-screen overflow-hidden` to the outer container and `overflow-y-auto` to the content div. These CSS properties clip content during printing — the browser can only print what fits in the viewport height, cutting off the rest of the work order.

## Changes

### `src/index.css` — Add print overrides
In the `@media print` section, add rules to override the fixed-height/overflow constraints:

```css
/* Reset fixed-height layout for print */
.flex.h-screen {
  height: auto !important;
  overflow: visible !important;
}

main, .flex-1 {
  height: auto !important;
  overflow: visible !important;
}

.overflow-y-auto {
  overflow: visible !important;
  height: auto !important;
}
```

This ensures all content flows naturally across pages when printing, while keeping the tablet sidebar fix intact for screen use.

### Single file change: `src/index.css`

