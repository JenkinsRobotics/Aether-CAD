const DRAG_THRESHOLD_PX = 4;

/** Arbitrate the CAD navigation surface before the app's document-capture menu.
 * Some browsers emit contextmenu on press, others on release. A press-time menu
 * must wait until release so it cannot steal an orbit gesture. */
export function bindViewportContextGesture(viewport: HTMLElement, openMenu?: (event: MouseEvent) => void): () => void {
  const win = viewport.ownerDocument.defaultView!;
  type Gesture = {
    pointerId: number;
    x: number;
    y: number;
    active: boolean;
    dragged: boolean;
    handled: boolean;
    pending?: { target: Element; event: MouseEvent };
  };
  let gesture: Gesture | undefined;
  let replaying = false;
  const surface = (target: EventTarget | null): target is Element =>
    target instanceof win.Element && viewport.contains(target) &&
    !!target.closest('canvas.viewport-canvas, svg.cad-sketch-canvas');
  const moved = (event: PointerEvent) => {
    if (gesture?.active && event.pointerId === gesture.pointerId &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > DRAG_THRESHOLD_PX) {
      gesture.dragged = true;
    }
  };
  const down = (event: PointerEvent) => {
    // Sketch navigation forwards this same press onto the canvas.
    if (gesture?.active && gesture.pointerId === event.pointerId) return;
    gesture = event.button === 2 && surface(event.target)
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        active: true, dragged: false, handled: false }
      : undefined;
  };
  const up = (event: PointerEvent) => {
    if (!gesture?.active || event.pointerId !== gesture.pointerId || event.button !== 2) return;
    moved(event);
    gesture.active = false;
    if (gesture.dragged || !gesture.pending) return;
    const { target, event: original } = gesture.pending;
    gesture.handled = true;
    if (!target.isConnected) return;
    replaying = true;
    try {
      target.dispatchEvent(new win.MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2,
        clientX: original.clientX, clientY: original.clientY,
        screenX: original.screenX, screenY: original.screenY,
        ctrlKey: original.ctrlKey, shiftKey: original.shiftKey,
        altKey: original.altKey, metaKey: original.metaKey,
      }));
    } finally { replaying = false; }
  };
  const cancel = (event?: PointerEvent) => {
    if (gesture?.active && (!event || event.pointerId === gesture.pointerId)) {
      gesture.active = false;
      gesture.dragged = true;
      gesture.pending = undefined;
    }
  };
  const context = (event: MouseEvent) => {
    // Keyboard/context-menu-key events have button 0 and must remain usable.
    if (!surface(event.target)) return;
    if (!replaying && event.button === 2 && gesture && (gesture.active || gesture.dragged || gesture.handled)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (gesture.active && !gesture.dragged) gesture.pending = { target: event.target, event };
      return;
    }
    if (gesture && event.button === 2) gesture.handled = true;
    if (openMenu) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openMenu(event);
    }
  };
  const blur = () => cancel();
  win.addEventListener('pointerdown', down, true);
  win.addEventListener('pointermove', moved, true);
  win.addEventListener('pointerup', up, true);
  win.addEventListener('pointercancel', cancel, true);
  win.addEventListener('lostpointercapture', cancel, true);
  win.addEventListener('contextmenu', context, true);
  win.addEventListener('blur', blur);
  return () => {
    win.removeEventListener('pointerdown', down, true);
    win.removeEventListener('pointermove', moved, true);
    win.removeEventListener('pointerup', up, true);
    win.removeEventListener('pointercancel', cancel, true);
    win.removeEventListener('lostpointercapture', cancel, true);
    win.removeEventListener('contextmenu', context, true);
    win.removeEventListener('blur', blur);
    gesture = undefined;
  };
}
