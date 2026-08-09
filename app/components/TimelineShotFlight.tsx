"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import styles from "./TimelineShotFlight.module.css";

export type ShotRect = { left: number; top: number; width: number; height: number };

export function TimelineShotFlight({ destination, image, onFinish, source }: { destination: ShotRect; image: string; onFinish: () => void; source: ShotRect }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches) return onFinish();
    const animation = element.animate([
      { left: `${source.left}px`, top: `${source.top}px`, width: `${source.width}px`, height: `${source.height}px`, borderRadius: "8px", opacity: 1 },
      { left: `${destination.left}px`, top: `${destination.top}px`, width: `${destination.width}px`, height: `${destination.height}px`, borderRadius: "12px", opacity: 1 },
    ], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
    animation.onfinish = onFinish;
    return () => animation.cancel();
  }, [destination, onFinish, source]);
  return <><i aria-hidden="true" className={styles.wash} /><Image alt="" className={styles.flight} height={560} ref={ref} src={image} unoptimized width={928} /></>;
}
