import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Hide a sticky header while the finger is pushing the page up, bring it back the
 * moment the finger pulls down. The app scrolls inside an element, not the window,
 * so the element is passed in rather than assumed.
 *
 * Deliberately dumb about animation: it only says "hidden or not". The transition
 * (and its `motion-reduce` opt-out) belongs in the class list of whatever it moves.
 */
export function useHideOnScroll(
  scrollRef: RefObject<HTMLElement | null>,
  { enabled = true, threshold = 64 }: { enabled?: boolean; threshold?: number } = {},
): boolean {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;

    lastY.current = el.scrollTop;

    const onScroll = () => {
      const y = el.scrollTop;
      const delta = y - lastY.current;
      // A finger resting on the glass jitters by a pixel or two; ignore that.
      if (Math.abs(delta) < 6) return;
      lastY.current = y;

      if (y <= threshold) {
        setHidden(false);
        return;
      }
      if (delta > 0) {
        setHidden(true);
      } else if (delta < -8) {
        setHidden(false);
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, enabled, threshold]);

  return enabled ? hidden : false;
}

export default useHideOnScroll;
