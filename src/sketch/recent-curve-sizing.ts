import { mountRecentRectangle } from "./recent-rectangle";
import { mountRecentRadius } from "./recent-radius";
import { mountRecentEllipse } from "./recent-ellipse";
/** One lifecycle for optional post-placement sizing, with tool-specific controls. */
export function mountRecentCurveSizing(
  options: Parameters<typeof mountRecentRectangle>[0],
) {
  const radius = mountRecentRadius(options),
    ellipse = mountRecentEllipse(options),
    rectangle = mountRecentRectangle(options);
  return {
    clear() {
      radius.clear();
      ellipse.clear();
      rectangle.clear();
    },
    dispose() {
      radius.dispose();
      ellipse.dispose();
      rectangle.dispose();
    },
    offer(tool: string, previous: number, active: number) {
      radius.offer(tool, previous, active);
      ellipse.offer(tool, previous);
      rectangle.offer(tool, previous);
    },
    key(e: KeyboardEvent) {
      radius.key(e);
      ellipse.key(e);
      rectangle.key(e);
    },
  };
}
