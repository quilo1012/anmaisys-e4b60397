import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Hide a sticky header while the person scrolls DOWN inside a given scroll
 * container, and bring it back as soon as they scroll UP. The window itself
 * never scrolls in this app, so the container has to be passed in.
 */
export function useHideOnScroll(
  ref: RefObject<HTMLElement | null>,
  { enabled = true, threshold = 64 }: { enabled?: boolean; threshold?: number } = {},
): boolean {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    const el = ref.current;
    if (!el) return;

    lastY.current = el.scrollTop;

    const onScroll = () => {
      const y = el.scrollTop;
      const delta = y - lastY.current;
      if (Math.abs(delta) < 6) return;
      lastY.current = y;
      if (y <= threshold) {
        setHidden(false);
        return;
      }
      if (delta > 0) setHidden(true);
      else if (delta < -8) setHidden(false);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref, enabled, threshold]);

  return enabled ? hidden : false;
}
