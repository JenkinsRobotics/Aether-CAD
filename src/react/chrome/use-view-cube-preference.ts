import { useState } from "react";
const storageKey = "aether-cad.view-cube-visible";

/** Device UI preference, independent of document geometry and render presets. */
export function useViewCubePreference() {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(storageKey) !== "false"; } catch { return true; }
  });
  const toggle = () => {
    const next = !visible;
    setVisible(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Memory-only when storage is unavailable. */ }
  };
  return { visible, toggle };
}
