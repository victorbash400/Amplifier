import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { AslCue, AslPlacement } from "./timelineTypes";
import styles from "./ViewerAslOverlay.module.css";

const cwasaBase = "https://vhg.cmp.uea.ac.uk/tech/jas/vhg2026";
const cwasaConsoleFilter = `if (!window.__amplifierCwasaConsoleFilter) {
  window.__amplifierCwasaConsoleFilter = true;
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    const message = String(args[0] || "");
    if (message.includes("animgenAllocate: jagid: 0") || message.includes("animgenAllocate: Time Format: 0")) return;
    originalError(...args);
  };
}`;

type Cwasa = {
  addHook: (name: string, callback: () => void, avatar?: number) => void;
  init: (settings: Record<string, unknown>) => void;
  playSiGMLText: (sigml: string, avatar?: number) => void;
  stopSiGML: (avatar?: number) => void;
};

declare global { interface Window { CWASA?: Cwasa; __amplifierCwasaConsoleFilter?: boolean } }

export function ViewerAslOverlay({ cues, currentTime, onPlacementChange, placement, playing }: { cues: AslCue[]; currentTime: number; onPlacementChange: (placement: AslPlacement) => void; placement: AslPlacement; playing: boolean }) {
  const activeCue = cues.find((cue) => cue.start <= currentTime + .1 && cue.end > currentTime + .1);
  const lastCue = useRef<string | undefined>(undefined);
  const dragOffset = useRef<{ x: number; y: number } | undefined>(undefined);
  const signing = useRef(false);
  const [ready, setReady] = useState(false);

  function initialize() {
    const cwasa = window.CWASA;
    if (!cwasa) return;
    cwasa.addHook("avatarready", () => setReady(true), 0);
    cwasa.addHook("animactive", () => { signing.current = true; }, 0);
    cwasa.addHook("animidle", () => { signing.current = false; }, 0);
    cwasa.init({ useClientConfig: true, avSettings: { width: 768, height: 640, initAv: "anna", initCamera: [0, .32, 2.85, 2, 18, 30, -1, -1], initSpeed: 0, rateSpeed: 5 } });
  }

  useEffect(() => {
    const cwasa = window.CWASA;
    if (!cwasa || !ready) return;
    if (!playing || !activeCue) {
      if (signing.current) cwasa.stopSiGML(0);
      signing.current = false;
      lastCue.current = undefined;
      return;
    }
    if (lastCue.current === activeCue.id) return;
    lastCue.current = activeCue.id;
    signing.current = true;
    cwasa.playSiGMLText(activeCue.sigml, 0);
  }, [activeCue, playing, ready]);

  useEffect(() => () => { if (signing.current) window.CWASA?.stopSiGML(0); }, []);

  function beginDrag(event: PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLElement>) {
    if (!dragOffset.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const parent = event.currentTarget.parentElement?.getBoundingClientRect();
    const rect = event.currentTarget.getBoundingClientRect();
    if (!parent) return;
    const width = Math.max(1, parent.width - rect.width);
    const height = Math.max(1, parent.height - rect.height);
    onPlacementChange({ x: clamp((event.clientX - parent.left - dragOffset.current.x) / width), y: clamp((event.clientY - parent.top - dragOffset.current.y) / height) });
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    dragOffset.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function moveWithKeys(event: KeyboardEvent<HTMLElement>) {
    const change = event.shiftKey ? .1 : .025;
    const directions: Record<string, AslPlacement> = { ArrowLeft: { x: -change, y: 0 }, ArrowRight: { x: change, y: 0 }, ArrowUp: { x: 0, y: -change }, ArrowDown: { x: 0, y: change } };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    onPlacementChange({ x: clamp(placement.x + direction.x), y: clamp(placement.y + direction.y) });
  }

  const position = { left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, transform: `translate(${-placement.x * 100}%, ${-placement.y * 100}%)` };
  return <aside aria-label="Moveable ASL interpreter" className={styles.overlay} onKeyDown={moveWithKeys} onPointerCancel={endDrag} onPointerDown={beginDrag} onPointerMove={move} onPointerUp={endDrag} style={position} tabIndex={0}><link href={`${cwasaBase}/cwa/cwasa.css`} rel="stylesheet" /><Script id="cwasa-console-filter" strategy="afterInteractive">{cwasaConsoleFilter}</Script><Script onReady={initialize} src={`${cwasaBase}/cwa/allcsa.js`} strategy="afterInteractive" /><div className="CWASAAvatar av0" />{!ready && <span className={styles.loading}>Loading signer</span>}</aside>;
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
