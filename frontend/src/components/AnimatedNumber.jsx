import { useEffect, useRef, useState } from 'react';

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

export function AnimatedNumber({ value, duration = 420 }) {
  const isFiniteValue = typeof value === 'number' && Number.isFinite(value);
  const [display, setDisplay] = useState(value);
  const prevValueRef = useRef(isFiniteValue ? value : 0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (
      !isFiniteValue ||
      prefersReducedMotion() ||
      duration <= 0 ||
      typeof requestAnimationFrame === 'undefined'
    ) {
      setDisplay(value);
      if (isFiniteValue) {
        prevValueRef.current = value;
      }
      return undefined;
    }

    const from = prevValueRef.current;
    const to = value;

    if (from === to) {
      setDisplay(to);
      return undefined;
    }

    let startTime = null;

    const tick = (now) => {
      if (startTime === null) startTime = now;
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(from + (to - from) * eased);

      setDisplay(current);
      prevValueRef.current = current;

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        prevValueRef.current = to;
        setDisplay(to);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, duration, isFiniteValue]);

  return <>{display}</>;
}
