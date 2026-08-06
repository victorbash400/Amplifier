"use client";

import { useEffect, useRef } from "react";

type TimelineShortcutActions = {
  onDelete: (ripple: boolean) => void;
  onDeselect: () => void;
  onFit: () => void;
  onRedo: () => void;
  onSeek: (change: number) => void;
  onSetPlaying: (playing: boolean) => void;
  onSplit: () => void;
  onTogglePlayback: () => void;
  onToggleSnapping: () => void;
  onUndo: () => void;
  onZoom: (change: number) => void;
};

export function useTimelineShortcuts(actions: TimelineShortcutActions) {
  const actionsRef = useRef(actions);
  useEffect(() => { actionsRef.current = actions; }, [actions]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (isEditingText(event.target) || document.querySelector('[aria-modal="true"]')) return;
      const key = event.key.toLowerCase();
      const current = actionsRef.current;
      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) current.onRedo(); else current.onUndo();
        return;
      }
      if (key === " " || key === "spacebar") { event.preventDefault(); if (!event.repeat) current.onTogglePlayback(); }
      else if (key === "k") { event.preventDefault(); current.onSetPlaying(false); }
      else if (key === "l") { event.preventDefault(); current.onSetPlaying(true); }
      else if (key === "j") { event.preventDefault(); current.onSetPlaying(false); current.onSeek(-1); }
      else if (key === "arrowleft" || key === ",") { event.preventDefault(); current.onSetPlaying(false); current.onSeek(event.shiftKey ? -1 : -1 / 30); }
      else if (key === "arrowright" || key === ".") { event.preventDefault(); current.onSetPlaying(false); current.onSeek(event.shiftKey ? 1 : 1 / 30); }
      else if (key === "s") { event.preventDefault(); current.onSplit(); }
      else if (key === "backspace" || key === "delete") { event.preventDefault(); current.onDelete(event.shiftKey); }
      else if (key === "escape") current.onDeselect();
      else if (key === "n") { event.preventDefault(); current.onToggleSnapping(); }
      else if (key === "0") { event.preventDefault(); current.onFit(); }
      else if (key === "=" || key === "+") { event.preventDefault(); current.onZoom(1); }
      else if (key === "-") { event.preventDefault(); current.onZoom(-1); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
}

function isEditingText(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"));
}
