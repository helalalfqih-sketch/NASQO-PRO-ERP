import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  FlowStack, KeyboardInput, KeyboardProvider, PhoneFrame,
  type FlowControls, type FlowScreen,
} from "../src/hybrid/mobileAdapter";
import { useBackLayer } from "../src/hybrid/backCoordinator";
import { hybridBridge } from "../src/hybrid/bridge";
import { HYBRID_PROTOCOL_VERSION } from "../src/hybrid/contracts";
import { AccountSelectCombobox } from "../src/components/AccountSelectCombobox";
import type { AccountRecord } from "../src/types";
import "../src/hybrid/hybrid.css";

declare global {
  interface Window {
    __hybridBackLog: Array<{ action: string; payload: Record<string, unknown> }>;
    __sendHybridBack: (requestId?: string) => boolean;
    __dropHybridReply: boolean;
  }
}

// This fixture has no SQLite, Firebase, posting endpoint, or real device bridge.
// It mounts the Android React adapter itself, separate from src/mobile runtime.
window.__hybridBackLog = [];
window.__dropHybridReply = false;
hybridBridge.setTransportForTesting({
  postMessage(serialized) {
    const message = JSON.parse(serialized);
    window.__hybridBackLog.push(message);
    if (window.__dropHybridReply) return;
    queueMicrotask(() => hybridBridge.handleInbound({
      protocolVersion: HYBRID_PROTOCOL_VERSION,
      kind: "response",
      requestId: message.requestId,
      action: message.action,
      ok: true,
      data: {},
    }));
  },
});
window.__sendHybridBack = (requestId) => hybridBridge.handleInbound({
  protocolVersion: HYBRID_PROTOCOL_VERSION,
  kind: "event",
  event: "backPressed",
  payload: requestId ? { requestId } : {},
});

function screen(depth: number): FlowScreen {
  return {
    id: depth === 1 ? "dashboard" : depth === 2 ? "accounts-purchases-all" : "supplier-synthetic-1",
    render: (flow) => <FixtureScreen depth={depth} flow={flow} />,
  };
}

function FixtureScreen({ depth, flow }: { depth: number; flow: FlowControls }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  useBackLayer(menuOpen, () => { setMenuOpen(false); return true; }, 10);
  useBackLayer(dialogOpen, () => { setDialogOpen(false); return true; }, 20);
  return (
    <main>
      <h1>Screen {depth}</h1>
      <button onClick={() => flow.push(screen(depth + 1))}>Push screen {depth + 1}</button>
      <button onClick={() => setMenuOpen(true)}>Open menu {depth}</button>
      <KeyboardInput aria-label={`Search ${depth}`} value={query} onChange={(event) => setQuery(event.target.value)} />
      {menuOpen && <aside role="menu" aria-label="Supplier options">
        <button onClick={() => setDialogOpen(true)}>Open nested dialog</button>
      </aside>}
      {dialogOpen && <section role="dialog" aria-label="Nested dialog">
        Synthetic dialog
        <AccountSelectCombobox
          accounts={[{ id: "synthetic-picker-1", name: "Synthetic supplier", codeNumber: 1, category: "purchases", currency: "ريال" } as AccountRecord]}
          value="synthetic-picker-1" onChange={() => {}}
          ariaLabel="Synthetic account picker" searchAriaLabel="Synthetic account search"
          listTestId="synthetic-account-options"
        />
      </section>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <PhoneFrame><KeyboardProvider><FlowStack initial={screen(1)} /></KeyboardProvider></PhoneFrame>,
);
