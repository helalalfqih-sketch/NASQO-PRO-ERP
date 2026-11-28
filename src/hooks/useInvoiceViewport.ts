import { useLayoutEffect, useRef, useState } from 'react';
import { useKeyboardInsets } from '../mobile';

/** Measures the app-owned layer, so a desktop phone frame and a native WebView
 * both clear the keyboard without counting the IME inset twice. */
export function useInvoiceViewport(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardInsets();
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0, focusFrame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const node = ref.current;
        if (!node) return;
        const bounds = node.getBoundingClientRect(), vv = window.visualViewport;
        const viewportBottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
        const available = Math.max(0, Math.min(bounds.height - keyboard.bottomInset, viewportBottom - bounds.top));
        setHeight(Math.round(available));
        cancelAnimationFrame(focusFrame);
        focusFrame = requestAnimationFrame(() => {
        const focus = document.activeElement;
        if (focus instanceof HTMLElement && node.contains(focus)) {
          const body = node.querySelector<HTMLElement>('.invoice-modal-body');
          if (body && body.contains(focus)) {
            const b = body.getBoundingClientRect(), f = focus.getBoundingClientRect();
            if (f.bottom > b.bottom - 12) body.scrollTop += f.bottom - b.bottom + 20;
            else if (f.top < b.top + 12) body.scrollTop -= b.top - f.top + 20;
          }
        }
        });
      });
    };
    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    measure(); window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    ref.current?.addEventListener('focusin', measure);
    const node = ref.current;
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); observer.disconnect(); window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure); node?.removeEventListener('focusin', measure); };
  }, [open, keyboard.bottomInset]);
  return { ref, height };
}
