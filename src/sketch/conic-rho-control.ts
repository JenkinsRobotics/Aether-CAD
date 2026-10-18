import { evaluateDocumentVariables, type DocumentVariable } from '@aether/core/document';
import { resolveDimensionExpression, type SketchPoint } from '@aether/core/sketch';
import type { ConicRhoInput } from '../../freecad-engine/browser/conic-authoring';
import { conicPlacement } from '../../freecad-engine/browser/conic-authoring';

/** The existing Aether tool field doubles as automatic post-control entry.
 * A displayed pointer value is transient until Enter or a fourth canvas click. */
export function mountConicRhoControl(parent: HTMLElement, preview: () => void,
  variables: () => readonly DocumentVariable[] | undefined, confirm: () => void = () => {}) {
  const label = document.createElement('label'), input = document.createElement('input');
  let manual = false, active = false, curvatureReady = false, automatic = .5;
  label.textContent = 'Rho';
  input.type = 'text'; input.placeholder = 'From pointer (0 < rho < 1)';
  input.setAttribute('aria-label', 'Conic rho');
  input.title = 'Dimensionless curvature: below 0.5 ellipse, 0.5 parabola, above 0.5 hyperbola. Enter confirms; formulas such as =#shape / 2 are supported.';
  label.append(input); label.hidden = true; parent.append(label);
  const read = (): ConicRhoInput | undefined => {
    const expression = input.value.trim().replace(/^=\s*/, '');
    if (!manual || !expression) return undefined;
    const value = resolveDimensionExpression({ id: 'preview', kind: 'conic-rho', a: { contour: 0, kind: 'curve', index: 0 } }, expression, evaluateDocumentVariables(variables()));
    if (value <= 0 || value >= 1) throw Error('Conic rho must be greater than 0 and less than 1.');
    return { value, ...(/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(expression) ? {} : { expression }) };
  };
  const validate = () => {
    try { read(); input.setCustomValidity(''); input.removeAttribute('aria-invalid'); return true; }
    catch (error) { input.setCustomValidity((error as Error).message); input.setAttribute('aria-invalid', 'true'); return false; }
  };
  input.addEventListener('input', () => { manual = !!input.value.trim(); validate(); preview(); });
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault(); event.stopPropagation();
    if (!manual) input.value = String(automatic);
    if (!input.value.trim()) input.value = '0.5';
    manual = true;
    if (validate()) { preview(); confirm(); }
  });
  return {
    read,
    previewValue: () => manual ? read() : curvatureReady ? { value: automatic } : undefined,
    reset: () => { manual = false; input.value = ''; validate(); },
    update: (tool: string) => { label.hidden = tool !== 'conic'; if (label.hidden) { manual = false; input.value = ''; validate(); } },
    observe: (tool: string, pending: readonly SketchPoint[], cursor: SketchPoint | null) => {
      active = tool === 'conic' && pending.length >= 2;
      curvatureReady = tool === 'conic' && pending.length === 3;
      if (manual) return;
      if (!curvatureReady) { input.value = ''; automatic = .5; return; }
      try {
        if (cursor) automatic = conicPlacement([...pending, cursor]).segments[0].rho;
        input.value = String(Number(automatic.toFixed(6)));
        if (document.activeElement === input) input.select();
      } catch { /* Retain the last valid pointer value while outside the rho domain. */ }
    },
    offer: () => { if (!manual) { if (!input.value) input.value = '0.5'; input.focus(); input.select(); } },
    key: (event: KeyboardEvent) => {
      if (!active || event.ctrlKey || event.metaKey || event.altKey || !/^[0-9.#=]$/.test(event.key)) return false;
      event.preventDefault(); event.stopPropagation(); manual = true;
      input.value = event.key; input.focus(); input.setSelectionRange(1, 1); validate(); preview(); return true;
    },
  };
}
