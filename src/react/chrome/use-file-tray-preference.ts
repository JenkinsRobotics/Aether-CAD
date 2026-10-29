import { useState } from "react";

const storageKey = "aether-cad.file-tray-visible";

/** Device UI preference: documents never decide whether the file tray is open. */
export function useFileTrayPreference() {
  const [visible, updateVisible] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });

  const toggle = () => {
    const next = !visible;
    updateVisible(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // Keep the manual toggle usable when browser storage is unavailable.
    }
  };

  return { visible, toggle };
}
