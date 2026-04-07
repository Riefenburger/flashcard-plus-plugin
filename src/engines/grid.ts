import { App } from 'obsidian';
import { renderMathInContainer } from '../utils/render-math';

/** Splits a CSS string into flat property declarations and selector rule blocks. */
function splitFlatAndRules(css: string): { flat: string; rules: string } {
    const ruleBlocks: string[] = [];
    const flatParts: string[] = [];
    let remaining = css;

    while (true) {
        const open = remaining.indexOf('{');
        if (open === -1) { flatParts.push(remaining); break; }
        const close = remaining.indexOf('}', open);
        if (close === -1) { flatParts.push(remaining); break; }

        const before = remaining.slice(0, open);
        const semiIdx = before.lastIndexOf(';');
        if (semiIdx >= 0) {
            flatParts.push(before.slice(0, semiIdx + 1));
            const selector = before.slice(semiIdx + 1).trim();
            const content = remaining.slice(open + 1, close).trim();
            if (selector) ruleBlocks.push(`${selector} { ${content} }`);
        } else {
            const selector = before.trim();
            const content = remaining.slice(open + 1, close).trim();
            if (selector) ruleBlocks.push(`${selector} { ${content} }`);
        }
        remaining = remaining.slice(close + 1);
    }

    const flat = flatParts.join('').replace(/\s+/g, ' ').trim().replace(/;+$/, '').trim();
    return { flat, rules: ruleBlocks.join('\n') };
}

function resolve(str: string, dict: Record<string, string>): string {
    return str.replace(/\{\{([^}]+)\}\}/g, (_, key) => dict[key.trim()] ?? `{{${key}}}`);
}

export class GridEngine {
    static renderInModal(
        _app: App,
        _filePath: string,
        container: HTMLElement,
        cardData: any,
        cloze: any,
        onComplete: (isCorrect: boolean, userAnswer: string) => void,
        dict: Record<string, string> = {}
    ) {
        container.empty();

        const cols: number = cardData.columns || 18;
        const categories: Record<string, string> = cardData.categories || {};
        const targetRow: number = cloze.coords?.[0] ?? -1;
        const targetAIdx: number = cloze.coords?.[1] ?? -1;
        const mirrorVars: string[] = Array.isArray(cardData.mirrorVars) ? cardData.mirrorVars : [];

        const mirrorSet = new Set<string>();
        (cardData.mirrors || []).forEach((m: any) => {
            if (Array.isArray(m.coords)) mirrorSet.add(`${m.coords[0]}-${m.coords[1]}`);
        });

        const mirrorDataArr: string[] = (Array.isArray(cloze.mirrorData) ? cloze.mirrorData : [])
            .map((v: string) => resolve(v, dict));
        const rows: any[][] = Array.isArray(cardData.data) ? cardData.data : [];

        // ── Grid ────────────────────────────────────────────────────────────
        container.createEl('h3', {
            text: cardData.title || 'Fill the Grid',
            attr: { style: 'margin-bottom: 8px; font-size: 1em;' }
        });

        // Scrollable wrapper — lets the grid pan horizontally on mobile
        const gridWrap = container.createDiv({ cls: 'gi-grid-review-grid-wrap' });
        const gridEl = gridWrap.createDiv({ cls: 'gi-grid-review' });
        gridEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

        const covered = new Set<number>();
        const indexAt = (r: number, c: number) => r * cols + c;
        let targetCellEl: HTMLElement | null = null;

        rows.forEach((row: any[], rIdx: number) => {
            if (!Array.isArray(row)) return;
            let cIdx = 0;
            let aIdx = 0;

            row.forEach((cellStr: any) => {
                while (cIdx < cols && covered.has(indexAt(rIdx, cIdx))) cIdx++;
                if (cIdx >= cols) return;

                const parts = String(cellStr).split(':');
                const val = resolve(parts[0] ?? '', dict);
                const cat = parts[1] || null;
                const colSpan = Math.max(1, parseInt(parts[2] ?? '1') || 1);
                const rowSpan = Math.max(1, parseInt(parts[3] ?? '1') || 1);
                const catCssRaw = (cat && categories[cat]) ? categories[cat] : '';
                const isEmpty = val === '';
                const isTarget = (rIdx === targetRow && aIdx === targetAIdx);
                const isMirror = mirrorSet.has(`${rIdx}-${aIdx}`);

                for (let dr = 0; dr < rowSpan; dr++) {
                    for (let dc = 0; dc < colSpan; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        covered.add(indexAt(rIdx + dr, cIdx + dc));
                    }
                }

                const cell = gridEl.createDiv({ cls: 'gi-grid-review-cell' });
                cell.style.gridColumn = `span ${colSpan}`;
                cell.style.gridRow = `span ${rowSpan}`;

                if (catCssRaw) {
                    const { flat, rules } = splitFlatAndRules(catCssRaw);
                    if (flat) {
                        cell.setAttribute('style', cell.getAttribute('style') + '; ' + flat);
                    }
                    if (rules && isMirror) {
                        const scopeId = `gi-m-${rIdx}-${aIdx}`;
                        cell.dataset.giMirrorId = scopeId;
                        const scoped = rules.replace(/(^|\})\s*([^{}]+)\s*\{/g, (_, prev, sel) => {
                            const scopedSel = sel.trim().split(',')
                                .map((s: string) => `[data-gi-mirror-id="${scopeId}"] ${s.trim()}`)
                                .join(', ');
                            return `${prev}${scopedSel}{`;
                        });
                        const styleEl = document.createElement('style');
                        styleEl.textContent = scoped;
                        cell.appendChild(styleEl);
                    }
                }

                if (isEmpty) {
                    cell.addClass('gi-grid-review-cell--empty');
                } else if (isTarget) {
                    cell.addClass('gi-grid-review-cell--target');
                    cell.setText('?');
                    targetCellEl = cell;
                } else if (isMirror) {
                    cell.addClass('gi-grid-review-cell--mirror');
                    mirrorVars.forEach((name, i) => {
                        cell.style.setProperty(`--gi-${name}`, mirrorDataArr[i] ?? '');
                    });
                    if (mirrorDataArr.length > 0) {
                        mirrorVars.forEach((name, i) => {
                            const v = mirrorDataArr[i] ?? '';
                            if (!v) return;
                            const line = cell.createDiv({
                                cls: `gi-mirror-line gi-mirror-var gi-mirror-var--${name}`
                            });
                            renderMathInContainer(line, v);
                        });
                    }
                } else {
                    cell.setText(val);
                }

                cIdx += colSpan;
                aIdx++;
            });
        });

        // ── Pan grid so the target ? cell is horizontally centred ────────────
        if (targetCellEl) {
            const target = targetCellEl as HTMLElement;
            requestAnimationFrame(() => {
                const cellLeft = target.offsetLeft;
                const cellWidth = target.offsetWidth;
                const wrapWidth = gridWrap.clientWidth;
                gridWrap.scrollLeft = cellLeft - wrapWidth / 2 + cellWidth / 2;
            });
        }

        // ── Input ────────────────────────────────────────────────────────────
        const inputRow = container.createDiv({ cls: 'gi-grid-review-input-row' });
        const input = inputRow.createEl('input', {
            type: 'text',
            placeholder: 'Answer…',
            cls: 'gi-grid-review-input'
        });
        setTimeout(() => input.focus(), 50);

        const submit = (answer: string) => {
            const userAnswer = answer.trim().toLowerCase();
            const isCorrect = (cloze.answers || []).some((a: string) => resolve(a, dict).toLowerCase() === userAnswer);
            input.disabled = true;
            onComplete(isCorrect, answer.trim());
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !input.disabled) submit(input.value);
        };
    }
}
