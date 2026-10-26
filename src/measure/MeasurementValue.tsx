import { useRef, useState } from 'react';
import { AetherIcon } from '@aether/ui';
import type { MeasurementAnnotation } from './measurement-overlay';
/** A value can be copied independently of its viewport annotation. */
export function MeasurementValue({ text, fullText, label, annotation, pinned, onPreview, onPin }: {
    text: string;
    fullText?: string;
    label: string;
    annotation?: MeasurementAnnotation;
    pinned: boolean;
    onPreview(value: MeasurementAnnotation | null): void;
    onPin(): void;
}) {
    const [copied, setCopied] = useState(false);
    const output = useRef<HTMLOutputElement>(null);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(fullText ?? text);
            setCopied(true);
        }
        catch {
            const selection = window.getSelection(), node = output.current;
            if (selection && node) {
                const range = document.createRange();
                range.selectNodeContents(node);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }
    };
    return <span className="cad-measure-value" onMouseEnter={() => onPreview(annotation ?? null)} onMouseLeave={() => onPreview(null)}>
    <output ref={output} data-measure-value={label} title={fullText ?? text}>{text}</output>
    {fullText && <button type="button" className="cad-measure-value-action" aria-label={`Copy ${label}`} title={copied ? 'Copied' : 'Copy full precision'} onClick={() => void copy()}><AetherIcon name={copied ? 'check' : 'copy'}/></button>}
    {annotation && <button type="button" className="cad-measure-value-action" aria-label={`Pin ${label}`} aria-pressed={pinned} title="Keep measurement visible" onClick={onPin} onFocus={() => onPreview(annotation)} onBlur={() => onPreview(null)}><AetherIcon name="pin"/></button>}
  </span>;
}
