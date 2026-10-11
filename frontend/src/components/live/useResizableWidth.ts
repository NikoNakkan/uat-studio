import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { readStored, writeStored } from '../../lib/storage';

const MIN = 320;
const KEEP_FOR_PAGE = 480;      // the page beside the panel never gets narrower than this
const STEP = 32;

/** How wide the panel may be in a window this wide. */
export function clampWidth(width: number, windowWidth: number): number {
  return Math.round(Math.max(MIN, Math.min(width, Math.max(MIN, windowWidth - KEEP_FOR_PAGE))));
}

/**
 * A side panel resized by dragging its left edge, like an IDE's: arrow keys move it too, a double click goes
 * back to the default, and the width is remembered in this browser.
 */
export function useResizableWidth(key: string, initial: () => number) {
  const [width, setWidth] = useState(() => clampWidth(Number(readStored(key)) || initial(), window.innerWidth));
  const drag = useRef<{ x: number; width: number } | null>(null);
  const save = useCallback((w: number) => {
    const next = clampWidth(w, window.innerWidth);
    setWidth(next);
    writeStored(key, String(next));
  }, [key]);

  useEffect(() => {
    const fit = () => setWidth(w => clampWidth(w, window.innerWidth));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const handle = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, width };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (drag.current) setWidth(clampWidth(drag.current.width + drag.current.x - e.clientX, window.innerWidth));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      if (!drag.current) return;
      save(drag.current.width + drag.current.x - e.clientX);
      drag.current = null;
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); save(width + STEP); }
      if (e.key === 'ArrowRight') { e.preventDefault(); save(width - STEP); }
    },
    onDoubleClick: () => save(initial()),
  };
  return { width, handle };
}
