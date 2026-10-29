import type { PartDocument } from "../aether-core";
import type { PartDisplayOverride } from "./part-display";

/** Physical density remains separate from the saved visual finish. */
export function documentBodyAppearance(
  document: PartDocument,
  bodyID: string,
): PartDisplayOverride {
  return { ...document.bodyProperties?.[bodyID]?.appearance };
}
