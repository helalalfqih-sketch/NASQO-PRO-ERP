import { createRoot } from "react-dom/client";
import { FlowStack, KeyboardProvider, MobileScroll, PhoneFrame } from "../src/hybrid/mobileAdapter";
import "../src/styles.css";
import "../src/hybrid/hybrid.css";

// Actual Android layout primitives; no database, host bridge or financial data.
createRoot(document.getElementById("root")!).render(
  <PhoneFrame><KeyboardProvider><FlowStack initial={{
    id: "dashboard",
    headerHeight: 52,
    header: () => <h1>Synthetic home</h1>,
    footerHeight: 52,
    footer: (flow) => <button onClick={() => flow.push({
      id: "settings", render: () => <h1>Synthetic settings</h1>,
    })}>Open settings</button>,
    render: () => <MobileScroll><p>Local workspace content</p></MobileScroll>,
  }} /></KeyboardProvider></PhoneFrame>,
);
