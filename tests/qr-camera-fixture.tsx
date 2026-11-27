import { useState } from "react";
import { createRoot } from "react-dom/client";
import { KeyboardProvider, PhoneFrame } from "../src/hybrid/mobileAdapter";
import { QrScannerModal as Scanner } from "../src/components/QrScannerModal";

const camera = {
  calls: [] as MediaStreamConstraints[], plays: 0, stopped: 0, writes: 0,
  mode: "grant" as "grant" | "pending" | "reject",
  error: "NotAllowedError", rejectPlay: false, deferPlay: false, streams: [] as unknown[],
  notifications: [] as string[],
  resolve: (() => {}) as () => void,
  resolvePlay: (() => {}) as () => void,
};
(window as any).__qrCamera = camera;
const realMedia = new URLSearchParams(location.search).has("realMedia");
const attached = new WeakMap<HTMLMediaElement, unknown>();
if (!realMedia) {
Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
  configurable: true, get() { return attached.get(this) ?? null; },
  set(value) { attached.set(this, value); },
});
HTMLMediaElement.prototype.play = async function () {
  camera.plays++;
  if (camera.rejectPlay) throw new DOMException("synthetic playback error", "NotReadableError");
  if (camera.deferPlay) await new Promise<void>((resolve) => { camera.resolvePlay = resolve; });
};
HTMLMediaElement.prototype.pause = function () {};
}
Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
  getUserMedia: (constraints: MediaStreamConstraints) => {
    camera.calls.push(constraints);
    if (realMedia) {
      // Browser-produced synthetic video; neither camera nor microphone hardware.
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d")!;
      const stream = canvas.captureStream(10);
      camera.streams.push(stream);
      let frame = 0;
      const paint = () => {
        if (!stream.getTracks().some((track) => track.readyState === "live")) return;
        context.fillStyle = frame++ % 2 ? "#123456" : "#456789";
        context.fillRect(0, 0, canvas.width, canvas.height);
        requestAnimationFrame(paint);
      };
      paint();
      return Promise.resolve(stream);
    }
    if (camera.mode === "reject") return Promise.reject(new DOMException("synthetic camera failure", camera.error));
    let stopped = false;
    const track = { kind: "video", readyState: "live", stop() {
      if (!stopped) camera.stopped++;
      stopped = true; this.readyState = "ended";
    }, addEventListener() {}, removeEventListener() {} };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track], active: true };
    camera.streams.push(stream);
    if (camera.mode === "pending") return new Promise((resolve) => { camera.resolve = () => resolve(stream); });
    return Promise.resolve(stream);
  },
} });

function Fixture() {
  const [open, setOpen] = useState(true);
  const [mounted, setMounted] = useState(true);
  (window as any).__qrSetOpen = setOpen;
  (window as any).__qrUnmount = () => setMounted(false);
  return <PhoneFrame><KeyboardProvider>
    <button onClick={() => setOpen(true)}>Open QR fixture</button>
    {mounted && <Scanner open={open} onClose={() => setOpen(false)} uid="synthetic-camera-workspace"
      inventory={[]} warehouses={[]} onNotify={(text) => camera.notifications.push(text)}
      onOpenInventoryReport={() => {}} onCreateItem={async () => { camera.writes++; }}
      onUpdateItem={async () => { camera.writes++; }} />}
  </KeyboardProvider></PhoneFrame>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
