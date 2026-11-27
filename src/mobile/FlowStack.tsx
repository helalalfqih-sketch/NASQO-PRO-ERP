import {
  createContext,
  type CSSProperties,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps } from "motion/react";
import { useDrag } from "@use-gesture/react";
import { useKeyboard, useKeyboardDismissDrag, useKeyboardInsets } from "./Keyboard";

export type FlowScreen = {
  id: string;
  title?: string;
  header?: (flow: FlowControls) => ReactNode;
  headerHeight?: number;
  footer?: (flow: FlowControls) => ReactNode;
  footerHeight?: number;
  render: (flow: FlowControls) => ReactNode;
};

type FlowEntry = FlowScreen & {
  key: string;
};

export type FlowControls = {
  current: FlowEntry;
  previous: FlowEntry | null;
  stack: FlowEntry[];
  canGoBack: boolean;
  push: (screen: FlowScreen) => void;
  pop: () => void;
  replace: (screen: FlowScreen) => void;
  reset: (screen: FlowScreen) => void;
};

const FlowContext = createContext<FlowControls | null>(null);

export function useFlow() {
  const context = useContext(FlowContext);

  if (!context) {
    throw new Error("useFlow must be used inside FlowStack");
  }

  return context;
}

function FlowProvider({ value, children }: PropsWithChildren<{ value: FlowControls }>) {
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

// Keep parked screens mounted for back navigation, but do not expose their
// controls to keyboard users or Android accessibility. Exiting screens must
// become inert immediately, before the slide animation removes their DOM.
function FlowScene({ active, ...props }: HTMLMotionProps<"div"> & { active: boolean }) {
  const present = useIsPresent();
  const interactive = active && present;
  return <motion.div {...props} inert={!interactive} aria-hidden={!interactive}
    data-flow-current={interactive ? "true" : "false"}
    data-testid={interactive ? "flow-current" : undefined} />;
}

function shouldIgnoreEdgeSwipe(target: EventTarget | null, boundary: HTMLElement | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [data-scroll-drag="ignore"], [role="slider"]')) {
    return true;
  }
  let node: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement;
  while (node && node !== boundary) {
    if (node.scrollWidth > node.clientWidth + 4) {
      const overflowX = window.getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") {
        return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

export function FlowStack({ initial, onSystemBack }: { initial: FlowScreen; onSystemBack?: () => boolean }) {
  const keyboard = useKeyboard();
  const { bottomInset, keyboardDragging } = useKeyboardInsets();
  const dismissKeyboardDrag = useKeyboardDismissDrag();
  const stackRef = useRef<HTMLDivElement | null>(null);
  const [screenWidth, setScreenWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 393,
  );
  const sequence = useRef(1);
  const edgeSwipeSide = useRef<"left" | "right" | null>(null);
  const initialEntry = useRef<FlowEntry>({ ...initial, key: `${initial.id}-0` });
  const [stack, setStack] = useState<FlowEntry[]>(() => [initialEntry.current]);
  const [direction, setDirection] = useState(1);
  const [swipeX, setSwipeX] = useState(0);
  // Keep the Android/PWA hardware Back gesture inside the application. The guard
  // is re-armed after every browser Back so it cannot exit on an open modal or
  // a nested flow. No route data or accounting records are written to history.
  const systemBackRef = useRef(onSystemBack);
  systemBackRef.current = onSystemBack;
  const internalPopRef = useRef<() => void>(() => {});
  useEffect(() => {
    const guardKey = "__nasqo_flow_back_guard__";
    const arm = () => {
      window.history.pushState({ ...window.history.state, [guardKey]: true }, "", window.location.href);
    };
    arm();
    const onPopState = () => {
      // Restore the guard first, including when the user is at the dashboard.
      arm();
      if (systemBackRef.current?.()) return;
      internalPopRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const element = stackRef.current;
    if (!element) return;

    const updateWidth = () => {
      if (element.clientWidth > 0) {
        setScreenWidth(element.clientWidth);
      }
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const toEntry = useCallback((screen: FlowScreen): FlowEntry => {
    const next = sequence.current;
    sequence.current += 1;
    return { ...screen, key: `${screen.id}-${next}` };
  }, []);

  const pop = useCallback(() => {
    keyboard.hide();
    setDirection(-1);
    setSwipeX(0);
    setStack((currentStack) => {
      if (currentStack.length <= 1) return currentStack;
      return currentStack.slice(0, -1);
    });
  }, [keyboard]);

  const controls = useMemo<FlowControls>(() => {
    const current = stack[stack.length - 1];
    const previous = stack.length > 1 ? stack[stack.length - 2] : null;

    return {
      current,
      previous,
      stack,
      canGoBack: stack.length > 1,
      push: (screen) => {
        keyboard.hide();
        setDirection(1);
        setSwipeX(0);
        setStack((currentStack) => {
          const top = currentStack[currentStack.length - 1];
          if (top && top.id === screen.id) return currentStack;
          return [...currentStack, toEntry(screen)];
        });
      },
      pop,
      replace: (screen) => {
        keyboard.hide();
        setDirection(1);
        setSwipeX(0);
        setStack((currentStack) => {
          const next = currentStack.slice(0, -1);
          return [...next, toEntry(screen)];
        });
      },
      reset: (screen) => {
        keyboard.hide();
        setDirection(-1);
        setSwipeX(0);
        setStack([toEntry(screen)]);
      },
    };
  }, [keyboard, pop, stack, toEntry]);

  internalPopRef.current = pop;

  const bindEdgeSwipe = useDrag(
    (state) => {
      if (!controls.canGoBack) return;

      if (state.first) {
        const candidate =
          state.currentTarget instanceof Element
            ? state.currentTarget
            : state.event?.currentTarget instanceof Element
              ? state.event.currentTarget
              : stackRef.current;
        if (
          !candidate ||
          typeof candidate.getBoundingClientRect !== "function" ||
          shouldIgnoreEdgeSwipe(state.event?.target ?? null, stackRef.current)
        ) {
          edgeSwipeSide.current = null;
          return;
        }
        const bounds = candidate.getBoundingClientRect();
        const isRtl = window.getComputedStyle(candidate).direction === "rtl";
        const fromLeftEdge = state.initial[0] - bounds.left < 24;
        const fromRightEdge = bounds.right - state.initial[0] < 24;
        if (fromLeftEdge) {
          edgeSwipeSide.current = "left";
        } else if (isRtl && fromRightEdge) {
          edgeSwipeSide.current = "right";
        } else {
          edgeSwipeSide.current = null;
        }
      }

      const side = edgeSwipeSide.current;
      if (!side) return;

      const [movementX, movementY] = state.movement;
      if (Math.abs(movementY) > Math.abs(movementX) * 0.85 && Math.abs(movementX) < 20) {
        if (state.last) {
          setSwipeX(0);
          edgeSwipeSide.current = null;
        }
        return;
      }

      const [velocityX] = state.velocity;
      const [directionX] = state.direction;
      const progress =
        side === "left"
          ? Math.max(0, Math.min(movementX, screenWidth))
          : Math.max(0, Math.min(-movementX, screenWidth));

      if (!state.last) {
        setSwipeX(progress);
        return;
      }

      const movingTowardBack = side === "left" ? directionX > 0 : directionX < 0;
      const shouldPop = progress > 88 || (velocityX > 0.42 && movingTowardBack && progress > 28);
      setSwipeX(0);
      edgeSwipeSide.current = null;

      if (shouldPop) {
        controls.pop();
      }
    },
    {
      axis: "lock",
      filterTaps: true,
      pointer: { touch: true },
    },
  );

  const topIndex = stack.length - 1;
  const parkedX = -screenWidth * 0.28;
  const header = controls.current.header?.(controls);
  const headerHeight = controls.current.headerHeight ?? 0;
  const headerSafeArea = 0;
  const totalHeaderHeight = header ? headerSafeArea + headerHeight : 0;
  const footer = controls.current.footer?.(controls);
  const footerHeight = controls.current.footerHeight ?? 0;

  const screenVariants = {
    enter: (animationDirection: number) => ({
      x: animationDirection > 0 ? screenWidth : parkedX,
      scale: animationDirection > 0 ? 1 : 0.985,
    }),
    exit: (animationDirection: number) => ({
      x: animationDirection < 0 ? screenWidth : parkedX,
      scale: animationDirection < 0 ? 1 : 0.985,
    }),
  };

  return (
    <FlowProvider value={controls}>
      <div
        ref={stackRef}
        className="flow-stack"
        data-testid="flow-stack"
        data-keyboard-dragging={keyboardDragging ? "true" : "false"}
        style={
          {
            "--flow-header-height": `${totalHeaderHeight}px`,
            "--flow-header-content-height": `${headerHeight}px`,
            "--flow-header-safe-area": `${headerSafeArea}px`,
            "--flow-footer-height": `${footer ? footerHeight : 0}px`,
            "--keyboard-height": `${bottomInset}px`,
          } as CSSProperties
        }
        {...bindEdgeSwipe()}
      >
        {header ? (
          <header className="flow-fixed-header" data-testid="flow-fixed-header">
            {header}
          </header>
        ) : null}
        <div className="flow-scenes">
          <AnimatePresence initial={false} custom={direction}>
            {stack.map((entry, index) => {
              const isTop = index === topIndex;
              const isVisible = index >= topIndex - 1;

              return (
                <FlowScene
                  key={entry.key}
                  className="flow-screen"
                  active={isTop}
                  custom={direction}
                  variants={screenVariants}
                  initial={isTop ? "enter" : false}
                  animate={{
                    x: isTop ? swipeX : parkedX,
                    scale: isTop ? 1 : 0.985,
                  }}
                  exit="exit"
                  transition={
                    swipeX > 0
                      ? { duration: 0 }
                      : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
                  }
                  style={{
                    opacity: isVisible ? 1 : 0,
                    pointerEvents: isTop ? "auto" : "none",
                    visibility: isVisible ? "visible" : "hidden",
                    zIndex: isTop ? 2 : 1,
                  }}
                >
                  {entry.render(controls)}
                </FlowScene>
              );
            })}
          </AnimatePresence>
        </div>
        {footer ? (
          <footer className="flow-fixed-footer" data-testid="flow-fixed-footer" {...dismissKeyboardDrag}>
            {footer}
          </footer>
        ) : null}
      </div>
    </FlowProvider>
  );
}
