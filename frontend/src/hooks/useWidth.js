import { useEffect, useState } from 'react';

// Measures an element so charts can be drawn in real pixels (keeps chart text
// at a readable size on narrow screens instead of scaling it down).
// Returns a callback ref so the measurement follows the element if the
// component swaps which node it renders.
export function useWidth(fallback = 640) {
  const [element, setElement] = useState(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!element) return undefined;
    const update = () => setWidth(Math.max(220, Math.floor(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}
