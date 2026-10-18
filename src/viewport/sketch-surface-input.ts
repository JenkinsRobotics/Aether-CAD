/** Navigation moves must not be reflected back into the sketch SVG. */
export function isSketchCameraGesture(event: MouseEvent): boolean {
  return event.button === 1 || event.button === 2 ||
    (["pointermove", "pointerleave"].includes(event.type) && Boolean(event.buttons & 6));
}

/** World-mounted SVG graphics can opt back into pointer hits for handles and
 * fills. Keep their left-button editing, but send navigation gestures to the
 * same canvas/controller that handles empty space. */
export function bindSketchCameraInput(svg: SVGSVGElement, canvas: HTMLElement): () => void {
  const win = svg.ownerDocument.defaultView!;
  let activePointer: number | undefined;
  const pointer = (event: PointerEvent) => {
    const navigate = event.type === 'pointercancel' ? activePointer === event.pointerId
      : event.type === 'pointermove' ? Boolean(event.buttons & 6) : event.button === 1 || event.button === 2;
    if (!navigate) return;
    if (event.type === 'pointerdown') activePointer = event.pointerId;
    if (event.type === 'pointerup' || event.type === 'pointercancel') activePointer = undefined;
    event.preventDefault(); event.stopImmediatePropagation();
    canvas.dispatchEvent(new win.PointerEvent(event.type, event));
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault(); event.stopImmediatePropagation();
    canvas.dispatchEvent(new win.WheelEvent('wheel', event));
  };
  const context = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const names = ['pointerdown','pointermove','pointerup','pointercancel'] as const;
  names.forEach(name => svg.addEventListener(name, pointer, true));
  svg.addEventListener('wheel', wheel, { capture: true, passive: false });
  svg.addEventListener('contextmenu', context, true);
  return () => {
    names.forEach(name => svg.removeEventListener(name, pointer, true));
    svg.removeEventListener('wheel', wheel, true);
    svg.removeEventListener('contextmenu', context, true);
  };
}
