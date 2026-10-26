import { useState } from "react";
const storageKey = "aether-cad.view-cube-visible";

/** Device UI preference, independent of document geometry and render presets. */
export function useViewCubePreference() {
  const [visible, updateVisible] = useState(() => {
    try { return localStorage.getItem(storageKey) !== "false"; } catch { return true; }
  });
  const setVisible = (next: boolean) => {
    updateVisible(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Memory-only when storage is unavailable. */ }
  };
  return { visible, setVisible, toggle: () => setVisible(!visible) };
}
