/** Which toggles the aux toolbar (bottom left) shows — a per-device choice in
 *  Settings › Layout. The toolbar controls the auxiliary card and the part list;
 *  the feature tree is the standard left column, so its toggle is opt-in. */
export const AUX_TOOLBAR_ITEMS = [
  { id: "comments", label: "Comments" },
  { id: "advisor", label: "AI advisor" },
  { id: "versions", label: "Version control" },
  { id: "files", label: "Files" },
  { id: "feature-tree", label: "Feature tree" },
] as const;
export type AuxToolbarItem = typeof AUX_TOOLBAR_ITEMS[number]["id"];
const DEFAULT: readonly AuxToolbarItem[] = ["comments", "advisor", "versions", "files"];
const KEY = "aether-cad.aux-toolbar.v1";
const known = new Set<string>(AUX_TOOLBAR_ITEMS.map(item => item.id));
const listeners = new Set<() => void>();

function read(): readonly AuxToolbarItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (Array.isArray(value)) {
      // Older layouts exposed History as a fifth icon. It now shares Versions.
      const migrated = value.map(id => id === "history" ? "versions" : id);
      return Object.freeze([...new Set(migrated.filter((id): id is AuxToolbarItem => typeof id === "string" && known.has(id)))]);
    }
  } catch { /* device preference only */ }
  return DEFAULT;
}
let current = read();

export const auxToolbarItems = (): readonly AuxToolbarItem[] => current;
export function subscribeAuxToolbarItems(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setAuxToolbarItem(id: AuxToolbarItem, shown: boolean) {
  const next = AUX_TOOLBAR_ITEMS.map(item => item.id).filter(item => item === id ? shown : current.includes(item));
  current = Object.freeze(next);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* device preference only */ }
  listeners.forEach(listener => listener());
}
