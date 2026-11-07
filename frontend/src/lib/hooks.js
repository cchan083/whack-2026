import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../theme.js";

/** Subscribe to a CSS media query. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** "wide" (>=1280px: rail + map + detail), "medium" (768-1279px) or "narrow" (<768px). */
export function useLayout() {
  const wide = useMediaQuery("(min-width: 1280px)");
  const medium = useMediaQuery("(min-width: 768px)");
  return wide ? "wide" : medium ? "medium" : "narrow";
}

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Animate a number towards `value` (instant under reduced motion). */
export function useCountUp(value, duration = 600) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (value == null || prefersReducedMotion() || from.current == null) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / duration);
      setShown(Math.round(a + (value - a) * easeInOutCubic(k)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, duration]);
  return shown;
}

/** True when keyboard shortcuts should be ignored (typing in a field). */
export function isTypingTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
