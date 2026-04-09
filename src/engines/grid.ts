import { App, setIcon } from 'obsidian';
import { renderMathInContainer } from '../utils/render-math';
import { BaseEngine } from './base-engine';

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

function resolveFromFormat(keys: string[], ns: string, dict: Record<string, string>): string[] {
    return keys.map(key => dict[`${ns}.${key}`] ?? key);
}

/**
 * Given a CSS string, extract the background color and return 'black' or 'white'
 * whichever has better contrast against it. Returns null if no color is found.
 */
function contrastColor(css: string): string | null {
    const m = css.match(/background(?:-color)?:\s*([^;]+)/);
    if (!m) return null;
    const raw = (m[1] ?? '').trim();
    // Parse hex colors only (#rgb or #rrggbb)
    let r = 0, g = 0, b = 0;
    const hex6 = raw.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    const hex3 = raw.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (hex6) {
        r = parseInt(hex6[1]!, 16);
        g = parseInt(hex6[2]!, 16);
        b = parseInt(hex6[3]!, 16);
    } else if (hex3) {
        r = parseInt(hex3[1]! + hex3[1]!, 16);
        g = parseInt(hex3[2]! + hex3[2]!, 16);
        b = parseInt(hex3[3]! + hex3[3]!, 16);
    } else {
        return null;
    }
    // Relative luminance (WCAG formula)
    const toLinear = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    return L > 0.179 ? '#000000' : '#ffffff';
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

        const fmt = cardData.clozeFormat;
        const ns: string | undefined = cloze.namespace;
        const useFormat = !!(ns && fmt);

        const mirrorDataArr: string[] = useFormat
            ? resolveFromFormat(Array.isArray(fmt.mirrorData) ? fmt.mirrorData : [], ns!, dict)
            : (Array.isArray(cloze.mirrorData) ? cloze.mirrorData : []).map((v: string) => resolve(v, dict));

        const answersArr: string[] = useFormat
            ? resolveFromFormat(Array.isArray(fmt.answers) ? fmt.answers : [], ns!, dict)
            : (cloze.answers || []).map((a: string) => resolve(a, dict));

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
                        let applied = flat;
                        // Auto-contrast text color unless the CSS already sets one
                        if (!/\bcolor\s*:/.test(flat)) {
                            const auto = contrastColor(flat);
                            if (auto) applied += `; color: ${auto}`;
                        }
                        cell.setAttribute('style', cell.getAttribute('style') + '; ' + applied);
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
            const isCorrect = answersArr.some((a: string) => a.toLowerCase() === userAnswer);
            input.disabled = true;
            onComplete(isCorrect, answer.trim());
        };

        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !input.disabled) submit(input.value);
        };
    }

    static renderIncorrectScreen(
        app: App,
        filePath: string,
        container: HTMLElement,
        cardData: any,
        cloze: any,
        userAnswer: string,
        onComplete: (wasCorrect: boolean) => void,
        dict: Record<string, string> = {},
        allCards: any[] = []
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

        const fmt = cardData.clozeFormat;
        const ns: string | undefined = cloze.clozeNamespace || cloze.namespace;
        const useFormat = !!(ns && fmt);

        // During-question mirror data
        const mirrorDataArr: string[] = useFormat
            ? resolveFromFormat(Array.isArray(fmt.mirrorData) ? fmt.mirrorData : [], ns!, dict)
            : (Array.isArray(cloze.mirrorData) ? cloze.mirrorData : []).map((v: string) => resolve(v, dict));

        // On incorrect screen: use incorrectMirrorData if set, otherwise fall back to mirrorData
        const incorrectMirrorArr: string[] = (useFormat && Array.isArray(fmt.incorrectMirrorData) && fmt.incorrectMirrorData.length > 0)
            ? resolveFromFormat(fmt.incorrectMirrorData, ns!, dict)
            : mirrorDataArr;

        const answersArr: string[] = useFormat
            ? resolveFromFormat(Array.isArray(fmt.answers) ? fmt.answers : [], ns!, dict)
            : (cloze.answers || []).map((a: string) => resolve(a, dict));

        // On incorrect screen: what to show IN the target cell
        const incorrectCellText: string = (useFormat && fmt.incorrectCellValue)
            ? (dict[`${ns}.${fmt.incorrectCellValue}`] ?? answersArr[0] ?? '')
            : (answersArr[0] ?? '');

        const rows: any[][] = Array.isArray(cardData.data) ? cardData.data : [];

        const card = container.createDiv({ cls: 'gi-incorrect-card' });

        // ── Header ────────────────────────────────────────────────────────────
        const hdr = card.createDiv({ cls: 'gi-incorrect-hdr' });
        const iconEl = hdr.createDiv({ cls: 'gi-incorrect-icon' });
        setIcon(iconEl, 'x-circle');
        hdr.createEl('span', { text: 'Incorrect', cls: 'gi-incorrect-title' });

        // ── Grid with answer revealed ─────────────────────────────────────────
        card.createEl('h3', {
            text: cardData.title || 'Fill the Grid',
            attr: { style: 'margin-bottom:8px; font-size:1em;' }
        });

        const gridWrap = card.createDiv({ cls: 'gi-grid-review-grid-wrap' });
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

                // Helper: scope a CSS rule-block string to a specific mirror cell
                const applyScopedRules = (cssRules: string, scopeId: string, targetEl: HTMLElement) => {
                    targetEl.dataset.giMirrorId = scopeId;
                    const scoped = cssRules.replace(/(^|\})\s*([^{}]+)\s*\{/g, (_, prev, sel) => {
                        const scopedSel = sel.trim().split(',')
                            .map((s: string) => `[data-gi-mirror-id="${scopeId}"] ${s.trim()}`)
                            .join(', ');
                        return `${prev}${scopedSel}{`;
                    });
                    const styleEl = document.createElement('style');
                    styleEl.textContent = scoped;
                    targetEl.appendChild(styleEl);
                };

                if (catCssRaw) {
                    const { flat, rules } = splitFlatAndRules(catCssRaw);
                    if (flat) {
                        let applied = flat;
                        if (!/\bcolor\s*:/.test(flat)) {
                            const auto = contrastColor(flat);
                            if (auto) applied += `; color: ${auto}`;
                        }
                        cell.setAttribute('style', (cell.getAttribute('style') || '') + '; ' + applied);
                    }
                    if (isMirror) {
                        // If incorrectMirrorCss is set, use it instead of the category's rules
                        const rulesToApply = (useFormat && fmt.incorrectMirrorCss)
                            ? fmt.incorrectMirrorCss
                            : rules;
                        if (rulesToApply) {
                            applyScopedRules(rulesToApply, `gi-m-${rIdx}-${aIdx}`, cell);
                        }
                    }
                } else if (isMirror && useFormat && fmt.incorrectMirrorCss) {
                    // No category CSS but we have incorrect mirror CSS
                    applyScopedRules(fmt.incorrectMirrorCss, `gi-m-${rIdx}-${aIdx}`, cell);
                }

                if (isEmpty) {
                    cell.addClass('gi-grid-review-cell--empty');
                } else if (isTarget) {
                    cell.addClass('gi-grid-review-cell--revealed');
                    cell.setText(incorrectCellText || val);
                    targetCellEl = cell;
                } else if (isMirror) {
                    cell.addClass('gi-grid-review-cell--mirror');
                    // Use the incorrect-specific mirror data (may have more entries than question mode).
                    // Class names come from incorrectMirrorData key names (e.g. ["number","symbol","mass"])
                    // so the CSS rules in incorrectMirrorCss match up correctly.
                    // mirrorVars only covers the question-mode set and may be shorter.
                    const incorrectKeyNames: string[] = (useFormat && Array.isArray(fmt.incorrectMirrorData))
                        ? fmt.incorrectMirrorData
                        : mirrorVars;
                    if (incorrectMirrorArr.length > 0) {
                        incorrectMirrorArr.forEach((v, i) => {
                            if (!v) return;
                            const name = incorrectKeyNames[i] ?? mirrorVars[i] ?? String(i);
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

        // Scroll to revealed cell
        if (targetCellEl) {
            const target = targetCellEl as HTMLElement;
            requestAnimationFrame(() => {
                const cellLeft = target.offsetLeft;
                const cellWidth = target.offsetWidth;
                const wrapWidth = gridWrap.clientWidth;
                gridWrap.scrollLeft = cellLeft - wrapWidth / 2 + cellWidth / 2;
            });
        }

        // ── Comparison, notes, extra info, actions ────────────────────────────
        // Build resolved cloze so BaseEngine can display the correct answers
        const resolvedCloze = {
            ...cloze,
            back: answersArr.length > 0 ? answersArr : (Array.isArray(cloze.back) ? cloze.back : (cloze.answers || [])),
        };
        BaseEngine.renderIncorrectContent(app, filePath, card, resolvedCloze, userAnswer, onComplete, allCards, dict, cardData);
    }
}
