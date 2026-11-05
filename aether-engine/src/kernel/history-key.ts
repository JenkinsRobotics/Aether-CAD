import type { PartFeature } from '../document/index';

/** Container readers and editor copies can reorder object properties without
 * changing a feature. Array order, including profile and reference order, is
 * still modeling intent and must invalidate the corresponding history tail. */
export function featureKeyJSON(feature: PartFeature): string {
  return JSON.stringify(feature, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
    }
    return value;
  });
}
