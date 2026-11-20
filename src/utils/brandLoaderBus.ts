type BrandLoaderEntry = {
  id: number;
  label: string;
};

type BrandLoaderListener = (activeLabel: string | null) => void;

let seq = 0;
let stack: BrandLoaderEntry[] = [];
const listeners = new Set<BrandLoaderListener>();

function getActiveLabel(): string | null {
  // Prefer the outermost (most specific) label when nested operations run,
  // avoiding visual flicker when a high-level action invokes lower-level DB helpers.
  return stack.length > 0 ? stack[0].label : null;
}

function notify() {
  const active = getActiveLabel();
  for (const listener of listeners) {
    listener(active);
  }
}

export function getActiveBrandLoaderLabel(): string | null {
  return getActiveLabel();
}

export function subscribeBrandLoader(listener: BrandLoaderListener): () => void {
  listeners.add(listener);
  listener(getActiveLabel());
  return () => {
    listeners.delete(listener);
  };
}

function waitMs(ms: number): Promise<void> {
  if (ms <= 0 || typeof window === "undefined") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export interface BrandLoaderOptions {
  /** Minimum visible duration in ms so fast local operations still show smooth feedback. */
  minDurationMs?: number;
  /** Optional delay in ms BEFORE invoking task() (useful before blocking calls like window.print()). */
  preDelayMs?: number;
}

/**
 * Runs any async or sync operation while displaying the global animated NASQO brand loader.
 * Supports nested/concurrent calls safely via reference-counted stacking.
 */
export async function runWithBrandLoader<T>(
  label: string,
  task: () => Promise<T> | T,
  options?: BrandLoaderOptions,
): Promise<T> {
  const isBrowser = typeof window !== "undefined";
  const minDurationMs = options?.minDurationMs ?? (isBrowser ? 360 : 0);
  const preDelayMs = options?.preDelayMs ?? 0;

  const id = ++seq;
  stack = [...stack, { id, label }];
  notify();

  const startedAt = Date.now();
  try {
    if (preDelayMs > 0 && isBrowser) {
      await waitMs(preDelayMs);
    }
    return await task();
  } finally {
    const elapsed = Date.now() - startedAt;
    const remaining = minDurationMs - elapsed;
    if (remaining > 0 && isBrowser) {
      await waitMs(remaining);
    }
    stack = stack.filter((item) => item.id !== id);
    notify();
  }
}
