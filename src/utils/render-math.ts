/**
 * Renders LaTeX math embedded in text into the given container element.
 *
 * Supports:
 *   - Display math: $$...$$
 *   - Inline math:  $...$
 *
 * Obsidian ships KaTeX via renderMath() / finishRenderMath(), so no
 * external dependency is needed.
 */
import { renderMath, finishRenderMath } from 'obsidian';

export function renderMathInContainer(container: HTMLElement, text: string): void {
    // Split on $$ first (display), then $ (inline)
    const segments = splitMath(text);
    for (const seg of segments) {
        if (seg.kind === 'text') {
            container.appendText(seg.content);
        } else {
            try {
                const mathEl = renderMath(seg.content, seg.kind === 'display');
                container.appendChild(mathEl);
            } catch {
                // Fallback: show raw LaTeX so the user can still read it
                container.createEl('code', { text: seg.content });
            }
        }
    }
    finishRenderMath();
}

type Segment =
    | { kind: 'text'; content: string }
    | { kind: 'inline' | 'display'; content: string };

function splitMath(text: string): Segment[] {
    const result: Segment[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        // Look for display math $$...$$ first
        const dispStart = remaining.indexOf('$$');
        const inlineStart = remaining.indexOf('$');

        if (dispStart === -1 && inlineStart === -1) {
            result.push({ kind: 'text', content: remaining });
            break;
        }

        // Prefer $$ when it appears before or at the same position as $
        if (dispStart !== -1 && (inlineStart === -1 || dispStart <= inlineStart)) {
            if (dispStart > 0) result.push({ kind: 'text', content: remaining.slice(0, dispStart) });
            const afterOpen = remaining.slice(dispStart + 2);
            const closeIdx = afterOpen.indexOf('$$');
            if (closeIdx === -1) {
                // Unclosed — treat rest as text
                result.push({ kind: 'text', content: remaining.slice(dispStart) });
                break;
            }
            result.push({ kind: 'display', content: afterOpen.slice(0, closeIdx) });
            remaining = afterOpen.slice(closeIdx + 2);
        } else {
            // Inline math $...$
            if (inlineStart > 0) result.push({ kind: 'text', content: remaining.slice(0, inlineStart) });
            const afterOpen = remaining.slice(inlineStart + 1);
            const closeIdx = afterOpen.indexOf('$');
            if (closeIdx === -1) {
                result.push({ kind: 'text', content: remaining.slice(inlineStart) });
                break;
            }
            result.push({ kind: 'inline', content: afterOpen.slice(0, closeIdx) });
            remaining = afterOpen.slice(closeIdx + 1);
        }
    }

    return result;
}
