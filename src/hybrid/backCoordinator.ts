import { useLayoutEffect, useRef } from "react";

type BackLayer = { handle: () => boolean; priority: number; order: number };
const layers = new Set<BackLayer>();
let sequence = 0;

/** Transient UI registers while visible; the most recently opened top layer wins. */
export function registerBackLayer(handle: () => boolean, priority = 0): () => void {
  const layer = { handle, priority, order: ++sequence };
  layers.add(layer);
  return () => layers.delete(layer);
}

export function consumeBackLayer(): boolean {
  for (const layer of [...layers].sort((a, b) => b.priority - a.priority || b.order - a.order)) {
    if (layer.handle()) return true;
  }
  return false;
}

export function useBackLayer(active: boolean, handle: () => boolean, priority = 0): void {
  const latest = useRef(handle);
  latest.current = handle;
  useLayoutEffect(() => active ? registerBackLayer(() => latest.current(), priority) : undefined,
    [active, priority]);
}
