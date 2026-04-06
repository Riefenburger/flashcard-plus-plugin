import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import { Setting } from 'obsidian';

// ── Types ──────────────────────────────────────────────────────────────────

interface PainterCell {
    value: string;
    category: string | null;   // named category from palette
    customCss: string;         // per-cell raw CSS override
    colSpan: number;
    rowSpan: number;
    isCloze: boolean;
    clozeAnswers: string;      // comma-separated, split at export time
    clozeNotes: string;
    mirrorData: string;        // newline-separated info shown in mirror cells when this cloze is active
    isMirror: boolean;         // this cell shows the active cloze's mirrorData during review
}

interface PainterCategory {
    name: string;
    css: string;
}

interface PainterState {
    title: string;
    deck: string;
    cardId: string;
    columns: number;
    rows: number;
    cells: PainterCell[];
    categories: PainterCategory[];
    brushMode: 'none' | 'category' | 'eraser';
    activeBrush: string | null;
    selectedIndex: number;     // -1 = nothing selected
    spanMode: 'off' | 'expand' | 'shrink';
    mirrorVars: string[];      // named variable slots shared across all mirror cells
}

export interface EditContext {
    cardData: any;
    filePath: string;
    originalSource: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDefaultCell(): PainterCell {
    return {
        value: '', category: null, customCss: '',
        colSpan: 1, rowSpan: 1,
        isCloze: false, clozeAnswers: '', clozeNotes: '',
        mirrorData: '', isMirror: false,
    };
}

function cellIndex(cols: number, row: number, col: number): number {
    return row * cols + col;
}

function cellCoords(cols: number, index: number): { row: number; col: number } {
    return { row: Math.floor(index / cols), col: index % cols };
}

function computeShadowedIndices(state: PainterState): Set<number> {
    const shadowed = new Set<number>();
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.columns; c++) {
            const idx = cellIndex(state.columns, r, c);
            if (shadowed.has(idx)) continue;
            const cell = state.cells[idx]!;
            for (let dr = 0; dr < cell.rowSpan; dr++) {
                for (let dc = 0; dc < cell.colSpan; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const sr = r + dr, sc = c + dc;
                    if (sr < state.rows && sc < state.columns) {
                        shadowed.add(cellIndex(state.columns, sr, sc));
                    }
                }
            }
        }
    }
    return shadowed;
}

function computeAbsorbCandidates(state: PainterState): Set<number> {
    const result = new Set<number>();
    if (state.selectedIndex < 0 || state.brushMode !== 'none') return result;
    const { row: sr, col: sc } = cellCoords(state.columns, state.selectedIndex);
    const cell = state.cells[state.selectedIndex]!;
    const shadowed = computeShadowedIndices(state);

    // Right column
    const rightCol = sc + cell.colSpan;
    if (rightCol < state.columns) {
        for (let r = sr; r < sr + cell.rowSpan; r++) {
            const idx = cellIndex(state.columns, r, rightCol);
            if (!shadowed.has(idx)) result.add(idx);
        }
    }
    // Bottom row
    const bottomRow = sr + cell.rowSpan;
    if (bottomRow < state.rows) {
        for (let c = sc; c < sc + cell.colSpan; c++) {
            const idx = cellIndex(state.columns, bottomRow, c);
            if (!shadowed.has(idx)) result.add(idx);
        }
    }
    return result;
}

const AUTO_CAT_PATTERN = /^cell-\d+-\d+$/;

/**
 * Splits a CSS string into flat property declarations and selector rule blocks.
 * Flat part styles the cell container; rule blocks scope to var lines in review.
 * e.g. "background:navy; .gi-mirror-var--symbol { font-size:2em; }"
 *   → flat: "background:navy;" | rules: ".gi-mirror-var--symbol { font-size:2em; }"
 */
function splitFlatAndRules(css: string): { flat: string; rules: string } {
    const ruleBlocks: string[] = [];
    const flat = css
        .replace(/[^{}]+\{[^{}]*\}/g, (match) => { ruleBlocks.push(match.trim()); return ''; })
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^;+|;+$/g, '')
        .trim();
    return { flat, rules: ruleBlocks.join('\n') };
}

// ── Modal ──────────────────────────────────────────────────────────────────

export class GridPainterModal extends Modal {
    private state: PainterState;
    private editContext: EditContext | null = null;

    private gridEl: HTMLElement | null = null;
    private inspectorEl: HTMLElement | null = null;
    private paletteEl: HTMLElement | null = null;
    private focusPreviewEl: HTMLElement | null = null;  // the large preview in inspector
    private cellEls: HTMLElement[] = [];
    private isDragging = false;
    private gridListenerAC: AbortController | null = null;
    private focusCellOnRender = false;  // true only when first selecting a cell
    private mirrorSlotContainerEl: HTMLElement | null = null;

    constructor(app: App, editContext?: EditContext) {
        super(app);
        this.editContext = editContext ?? null;
        this.state = {
            title: 'My Grid Card',
            deck: 'Grand Inventory',
            cardId: '',
            columns: 18,
            rows: 10,
            cells: [],
            categories: [],
            brushMode: 'none',
            activeBrush: null,
            selectedIndex: -1,
            spanMode: 'off',
            mirrorVars: [],
        };
        this.initCells();
        if (editContext) this.loadFromCardData(editContext.cardData);
    }

    private initCells() {
        this.state.cells = Array.from(
            { length: this.state.rows * this.state.columns },
            () => makeDefaultCell()
        );
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-painter-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('grand-inventory-modal-window');

        // Escape exits focus mode (not the modal) when a cell is selected
        this.scope.register([], 'Escape', (evt) => {
            if (this.state.selectedIndex >= 0) {
                this.exitFocusMode();
                evt.preventDefault();
                return false;
            }
            return true;
        });

        this.buildStaticShell(contentEl);
        this.renderPalette();
        this.renderGrid();
        this.renderInspector();
    }

    onClose() {
        this.contentEl.empty();
    }

    // ── Shell ──────────────────────────────────────────────────────────────

    private buildStaticShell(container: HTMLElement) {
        // Metadata row
        const metaRow = container.createDiv({ cls: 'gi-painter-meta-row' });

        const titleWrap = metaRow.createDiv({ cls: 'gi-painter-field' });
        titleWrap.createEl('label', { text: 'Title' });
        const titleInput = titleWrap.createEl('input', { type: 'text' });
        titleInput.value = this.state.title;
        titleInput.oninput = () => { this.state.title = titleInput.value; };

        const deckWrap = metaRow.createDiv({ cls: 'gi-painter-field' });
        deckWrap.createEl('label', { text: 'Deck' });
        const deckInput = deckWrap.createEl('input', { type: 'text' });
        deckInput.value = this.state.deck;
        deckInput.oninput = () => { this.state.deck = deckInput.value; };

        const idWrap = metaRow.createDiv({ cls: 'gi-painter-field gi-painter-field--sm' });
        idWrap.createEl('label', { text: 'ID' });
        const idInput = idWrap.createEl('input', { type: 'text' });
        idInput.value = this.state.cardId;
        idInput.oninput = () => { this.state.cardId = idInput.value; };

        // Dimension row
        const dimRow = container.createDiv({ cls: 'gi-painter-dim-row' });

        const colWrap = dimRow.createDiv({ cls: 'gi-painter-field gi-painter-field--sm' });
        colWrap.createEl('label', { text: 'Columns' });
        const colInput = colWrap.createEl('input', { type: 'number', attr: { min: '1', max: '40' } });
        colInput.value = String(this.state.columns);
        colInput.onchange = () => {
            const v = Math.max(1, parseInt(colInput.value) || 1);
            colInput.value = String(v);
            this.resizeGrid(v, this.state.rows);
        };

        const rowWrap = dimRow.createDiv({ cls: 'gi-painter-field gi-painter-field--sm' });
        rowWrap.createEl('label', { text: 'Rows' });
        const rowInput = rowWrap.createEl('input', { type: 'number', attr: { min: '1', max: '40' } });
        rowInput.value = String(this.state.rows);
        rowInput.onchange = () => {
            const v = Math.max(1, parseInt(rowInput.value) || 1);
            rowInput.value = String(v);
            this.resizeGrid(this.state.columns, v);
        };

        // ── Mirror Variables ──────────────────────────────────────────────
        // Defines the named data slots shown in mirror cells during review.
        // Example: "number", "symbol", "mass" for the periodic table.
        const mirrorVarWrap = container.createDiv({ cls: 'gi-mirror-vars-row' });
        mirrorVarWrap.createEl('label', {
            text: 'Mirror slots (comma-separated names):',
            attr: { style: 'font-size:0.75em; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:0.05em;' }
        });
        const mirrorVarInput = mirrorVarWrap.createEl('input', { type: 'text' });
        mirrorVarInput.value = this.state.mirrorVars.join(', ');
        mirrorVarInput.placeholder = 'e.g. number, symbol, mass';
        mirrorVarInput.style.width = '100%';
        mirrorVarInput.oninput = () => {
            this.state.mirrorVars = mirrorVarInput.value
                .split(',')
                .map(s => s.trim().replace(/\s+/g, '_'))
                .filter(Boolean);
            // Only re-render the slot inputs — never the whole inspector (avoids focus steal)
            const idx = this.state.selectedIndex;
            if (idx >= 0 && this.mirrorSlotContainerEl) {
                const cell = this.state.cells[idx];
                if (cell?.isCloze) this.renderMirrorSlots(cell);
            }
        };

        // Grid canvas — at the top so the full grid is always visible
        const canvasWrap = container.createDiv({ cls: 'gi-painter-canvas-wrap' });
        this.gridEl = canvasWrap.createDiv({ cls: 'gi-painter-grid' });

        // Middle row: palette + inspector (below the canvas)
        const middleRow = container.createDiv({ cls: 'gi-painter-middle-row' });
        this.paletteEl = middleRow.createDiv({ cls: 'gi-painter-palette' });
        this.inspectorEl = middleRow.createDiv({ cls: 'gi-painter-inspector' });

        // Footer
        const footer = container.createDiv({ cls: 'gi-painter-footer' });
        if (this.editContext) {
            const saveBtn = footer.createEl('button', { text: 'Save to Note', cls: 'mod-cta' });
            saveBtn.style.width = '100%';
            saveBtn.onclick = () => this.saveToFile();
        } else {
            const copyBtn = footer.createEl('button', { text: 'Copy JSON to Clipboard', cls: 'mod-cta' });
            copyBtn.style.width = '100%';
            copyBtn.onclick = () => this.onCopyJSON();
        }
    }

    // ── Resize ─────────────────────────────────────────────────────────────

    private resizeGrid(newCols: number, newRows: number) {
        const oldCols = this.state.columns;
        const oldRows = this.state.rows;
        const oldCells = this.state.cells;

        const newCells: PainterCell[] = Array.from(
            { length: newRows * newCols },
            () => makeDefaultCell()
        );

        const copyRows = Math.min(oldRows, newRows);
        const copyCols = Math.min(oldCols, newCols);
        for (let r = 0; r < copyRows; r++) {
            for (let c = 0; c < copyCols; c++) {
                const cell = { ...oldCells[cellIndex(oldCols, r, c)]! };
                cell.colSpan = Math.min(cell.colSpan, newCols - c);
                cell.rowSpan = Math.min(cell.rowSpan, newRows - r);
                newCells[cellIndex(newCols, r, c)] = cell;
            }
        }

        this.state.columns = newCols;
        this.state.rows = newRows;
        this.state.cells = newCells;

        if (this.state.selectedIndex >= 0) {
            this.exitFocusMode();
        } else {
            this.renderGrid();
            this.renderInspector();
        }
    }

    // ── Grid Render ────────────────────────────────────────────────────────

    private renderGrid() {
        if (!this.gridEl) return;
        this.gridEl.empty();
        this.cellEls = [];

        this.gridEl.style.gridTemplateColumns = `repeat(${this.state.columns}, minmax(30px, 1fr))`;
        this.gridEl.toggleClass('gi-canvas--painting', this.state.brushMode !== 'none');

        const shadowed = computeShadowedIndices(this.state);
        const absorbCandidates = computeAbsorbCandidates(this.state);

        for (let r = 0; r < this.state.rows; r++) {
            for (let c = 0; c < this.state.columns; c++) {
                const idx = cellIndex(this.state.columns, r, c);
                const cell = this.state.cells[idx]!;
                const isShadowed = shadowed.has(idx);

                const el = this.gridEl.createDiv({ cls: 'gi-painter-cell' });
                el.dataset.giIndex = String(idx);

                if (isShadowed) {
                    el.style.display = 'none';
                } else {
                    this.applyCellStyle(el, cell, idx, absorbCandidates);
                }

                this.cellEls[idx] = el;
            }
        }

        // Tear down previous listeners before adding new ones
        if (this.gridListenerAC) this.gridListenerAC.abort();
        this.gridListenerAC = new AbortController();
        const { signal } = this.gridListenerAC;

        let lastPainted = -1;
        this.gridEl.addEventListener('pointerdown', (e) => {
            this.isDragging = true;
            (this.gridEl as HTMLElement).setPointerCapture(e.pointerId);
            lastPainted = -1;
            const idx = this.getIndexFromEvent(e);
            if (idx >= 0) { lastPainted = idx; this.paintCell(idx, true); }
        }, { signal });
        this.gridEl.addEventListener('pointermove', (e) => {
            if (!this.isDragging) return;
            const idx = this.getIndexFromEvent(e);
            if (idx >= 0 && idx !== lastPainted) { lastPainted = idx; this.paintCell(idx, false); }
        }, { signal });
        this.gridEl.addEventListener('pointerup', () => { this.isDragging = false; }, { signal });
        this.gridEl.addEventListener('pointercancel', () => { this.isDragging = false; }, { signal });
    }

    private getIndexFromEvent(e: PointerEvent): number {
        const cell = (e.target as HTMLElement).closest('[data-gi-index]') as HTMLElement | null;
        if (!cell) return -1;
        const idx = parseInt(cell.dataset.giIndex ?? '-1');
        return isNaN(idx) ? -1 : idx;
    }

    private resolvedCss(cell: PainterCell): string {
        let css = '';
        if (cell.category) {
            const cat = this.state.categories.find(c => c.name === cell.category);
            if (cat) css += splitFlatAndRules(cat.css).flat;
        }
        if (cell.customCss) {
            const flat = splitFlatAndRules(cell.customCss).flat;
            if (flat) css += (css ? '; ' : '') + flat;
        }
        return css;
    }

    private applyCellStyle(
        el: HTMLElement,
        cell: PainterCell,
        idx: number,
        absorbCandidates = new Set<number>()
    ) {
        const isSelected = idx === this.state.selectedIndex;
        const isFocusMode = this.state.selectedIndex >= 0;
        const isAbsorbCandidate = this.state.spanMode === 'expand' && absorbCandidates.has(idx);
        const css = this.resolvedCss(cell);

        el.setAttribute(
            'style',
            `grid-column: span ${cell.colSpan}; grid-row: span ${cell.rowSpan}; ${css}`
        );
        el.toggleClass('gi-selected', isSelected);
        el.toggleClass('gi-cloze-marker', cell.isCloze);
        el.toggleClass('gi-mirror-cell', cell.isMirror);
        el.toggleClass('gi-absorb-candidate', isAbsorbCandidate);
        el.toggleClass('gi-dimmed', isFocusMode && !isSelected && !isAbsorbCandidate);

        el.empty();
        if (cell.isMirror) {
            const badge = el.createSpan({ cls: 'gi-mirror-badge', text: '◈' });
            if (cell.value) el.createSpan({ text: ' ' + cell.value });
            void badge;
        } else if (cell.value) {
            el.createSpan({ text: cell.value });
        } else {
            const { row, col } = cellCoords(this.state.columns, idx);
            el.createSpan({ text: `${row},${col}`, cls: 'gi-painter-cell-coord' });
        }

        // Shrink handles — visible buttons on the selected cell's right/bottom edges
        if (isSelected && this.state.spanMode === 'shrink') {
            if (cell.colSpan > 1) {
                const h = el.createDiv({ cls: 'gi-shrink-handle gi-shrink-handle--col' });
                setIcon(h, 'chevron-left');
                h.title = `Shrink columns (${cell.colSpan} → ${cell.colSpan - 1})`;
                h.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                    cell.colSpan = Math.max(1, cell.colSpan - 1);
                    this.renderGrid();
                    this.renderInspector();
                });
            }
            if (cell.rowSpan > 1) {
                const h = el.createDiv({ cls: 'gi-shrink-handle gi-shrink-handle--row' });
                setIcon(h, 'chevron-up');
                h.title = `Shrink rows (${cell.rowSpan} → ${cell.rowSpan - 1})`;
                h.addEventListener('pointerdown', (e) => {
                    e.stopPropagation();
                    cell.rowSpan = Math.max(1, cell.rowSpan - 1);
                    this.renderGrid();
                    this.renderInspector();
                });
            }
        }
    }

    private updateCellEl(index: number) {
        const el = this.cellEls[index];
        if (!el) return;
        const shadowed = computeShadowedIndices(this.state);
        if (shadowed.has(index)) { el.style.display = 'none'; return; }
        el.style.display = '';
        const absorbCandidates = computeAbsorbCandidates(this.state);
        this.applyCellStyle(el, this.state.cells[index]!, index, absorbCandidates);
    }

    // ── Focus Mode ─────────────────────────────────────────────────────────

    // Dims all cells except the selected one (called when selecting a cell)
    private enterFocusMode(index: number) {
        const absorbCandidates = computeAbsorbCandidates(this.state);
        this.cellEls.forEach((el, i) => {
            if (!el || el.style.display === 'none') return;
            const isAbsorb = this.state.spanMode === 'expand' && absorbCandidates.has(i);
            el.toggleClass('gi-dimmed', i !== index && !isAbsorb);
            el.toggleClass('gi-selected', i === index);
            el.toggleClass('gi-absorb-candidate', isAbsorb);
        });
        // Re-render the selected cell to show/hide shrink handles
        if (this.cellEls[index]) this.applyCellStyle(this.cellEls[index]!, this.state.cells[index]!, index, absorbCandidates);
    }

    private exitFocusMode() {
        this.cellEls.forEach(el => {
            if (el) { el.removeClass('gi-dimmed'); el.removeClass('gi-selected'); el.removeClass('gi-absorb-candidate'); }
        });
        this.state.selectedIndex = -1;
        this.focusPreviewEl = null;
        this.renderGrid();
        this.renderInspector();
    }

    // Updates the large cell preview in the inspector (live as user types)
    private updateFocusPreview() {
        if (!this.focusPreviewEl || this.state.selectedIndex < 0) return;
        const cell = this.state.cells[this.state.selectedIndex];
        if (!cell) return;
        const css = this.resolvedCss(cell);
        this.focusPreviewEl.setAttribute('style', css);
        this.focusPreviewEl.empty();
        this.focusPreviewEl.createEl('span', {
            text: cell.value || '?',
            cls: 'gi-cell-preview-text'
        });
    }

    // ── Paint / Select ─────────────────────────────────────────────────────

    // Expand selected cell's span by clicking an adjacent cell.
    // Returns true if absorbed (caller should not change selection).
    private tryAbsorb(selectedIdx: number, targetIdx: number): boolean {
        const { row: sr, col: sc } = cellCoords(this.state.columns, selectedIdx);
        const { row: tr, col: tc } = cellCoords(this.state.columns, targetIdx);
        const cell = this.state.cells[selectedIdx]!;

        // Expand right
        if (tc === sc + cell.colSpan && tr >= sr && tr < sr + cell.rowSpan) {
            cell.colSpan = Math.min(cell.colSpan + 1, this.state.columns - sc);
            this.renderGrid();
            this.renderInspector();
            return true;
        }
        // Expand down
        if (tr === sr + cell.rowSpan && tc >= sc && tc < sc + cell.colSpan) {
            cell.rowSpan = Math.min(cell.rowSpan + 1, this.state.rows - sr);
            this.renderGrid();
            this.renderInspector();
            return true;
        }
        return false;
    }

    private paintCell(index: number, isPointerDown: boolean) {
        if (this.state.brushMode === 'none') {
            if (!isPointerDown) return;

            // In expand mode, clicking an absorb candidate grows the selected cell
            if (this.state.spanMode === 'expand' && this.state.selectedIndex >= 0 && index !== this.state.selectedIndex) {
                const absorb = computeAbsorbCandidates(this.state);
                if (absorb.has(index)) {
                    this.tryAbsorb(this.state.selectedIndex, index);
                    return;
                }
            }

            this.selectCell(index);
        } else {
            // Brush painting — skip cells covered by a span from above/left
            const shadowed = computeShadowedIndices(this.state);
            if (shadowed.has(index)) return;
            if (this.state.brushMode === 'category') {
                this.state.cells[index]!.category = this.state.activeBrush;
                this.updateCellEl(index);
            } else if (this.state.brushMode === 'eraser') {
                this.state.cells[index]!.category = null;
                this.state.cells[index]!.customCss = '';
                this.updateCellEl(index);
            }
        }
    }

    private selectCell(index: number) {
        // If clicking the already-selected cell, toggle off
        if (index === this.state.selectedIndex) {
            this.exitFocusMode();
            return;
        }

        this.state.selectedIndex = index;
        this.focusCellOnRender = true;
        this.enterFocusMode(index);
        this.renderInspector();
    }

    // ── Inspector ──────────────────────────────────────────────────────────

    private renderInspector() {
        if (!this.inspectorEl) return;
        this.inspectorEl.empty();
        this.focusPreviewEl = null;

        const idx = this.state.selectedIndex;
        if (idx < 0) {
            this.inspectorEl.createEl('p', {
                text: 'Select a cell to edit it.',
                cls: 'gi-inspector-placeholder'
            });
            return;
        }

        const cell = this.state.cells[idx]!;
        const { row, col } = cellCoords(this.state.columns, idx);

        // ── Header with Done button ──
        const hdr = this.inspectorEl.createDiv({ cls: 'gi-inspector-header' });
        hdr.createEl('strong', { text: `Cell (${row}, ${col})` });
        const doneBtn = hdr.createEl('button', { cls: 'mod-ghost' });
        setIcon(doneBtn, 'check');
        doneBtn.appendText(' Done');
        doneBtn.onclick = () => this.exitFocusMode();

        // ── Large live preview ──
        const previewWrap = this.inspectorEl.createDiv({ cls: 'gi-cell-preview-wrap' });
        const preview = previewWrap.createDiv({ cls: 'gi-cell-preview' });
        const css = this.resolvedCss(cell);
        preview.setAttribute('style', css);
        preview.createEl('span', { text: cell.value || '?', cls: 'gi-cell-preview-text' });
        this.focusPreviewEl = preview;

        // ── Value ──
        new Setting(this.inspectorEl)
            .setName('Value')
            .addText(t => {
                t.setValue(cell.value);
                t.onChange(v => {
                    cell.value = v;
                    this.updateCellEl(idx);
                    this.updateFocusPreview();
                });
                if (this.focusCellOnRender) {
                    this.focusCellOnRender = false;
                    setTimeout(() => t.inputEl.focus(), 50);
                }
            });

        // ── Per-cell CSS textarea ──
        const isMirrorCell = cell.isMirror;
        const cssDesc = isMirrorCell
            ? 'Flat properties style the cell box. Rule blocks style the variable lines during review.'
            : 'Styles this cell. Use min-width/min-height to resize.';
        const cssPlaceholder = isMirrorCell
            ? 'min-width:60px; min-height:70px;\n\n.gi-mirror-var--number { align-self:flex-start; font-size:0.65em; }\n.gi-mirror-var--symbol { font-size:2em; font-weight:700; }\n.gi-mirror-var--mass { font-size:0.6em; color:#888; }'
            : 'background:#fee2e2;\ncolor:#991b1b;\nmin-width:60px; min-height:60px;';
        new Setting(this.inspectorEl)
            .setName('CSS')
            .setDesc(cssDesc)
            .addTextArea(ta => {
                ta.setValue(cell.customCss);
                ta.inputEl.rows = isMirrorCell ? 6 : 3;
                ta.inputEl.style.width = '100%';
                ta.inputEl.style.fontFamily = 'monospace';
                ta.inputEl.style.fontSize = '0.8em';
                ta.inputEl.placeholder = cssPlaceholder;
                ta.onChange(v => {
                    cell.customCss = v;
                    this.updateCellEl(idx);
                    this.updateFocusPreview();
                });
            });

        // ── Category ──
        new Setting(this.inspectorEl)
            .setName('Category')
            .setDesc('Named style from palette')
            .addDropdown(d => {
                d.addOption('', '— none —');
                this.state.categories.forEach(cat => d.addOption(cat.name, cat.name));
                d.setValue(cell.category ?? '');
                d.onChange(v => {
                    cell.category = v || null;
                    this.updateCellEl(idx);
                    this.updateFocusPreview();
                });
            });

        // ── Span info (read-only; use Expand Mode on the palette to resize) ──
        if (cell.colSpan > 1 || cell.rowSpan > 1) {
            this.inspectorEl.createEl('small', {
                text: `Span: ${cell.colSpan}×${cell.rowSpan}  (use Expand Mode or CSS min-width/min-height to resize)`,
                attr: { style: 'color:var(--text-faint); display:block; margin: 4px 0 8px; font-size:0.78em;' }
            });
        }

        // ── Mirror cell toggle ──
        new Setting(this.inspectorEl)
            .setName('Mirror cell ◈')
            .setDesc('During review this cell shows the active cloze\'s info panel')
            .addToggle(t => {
                t.setValue(cell.isMirror);
                t.onChange(v => {
                    cell.isMirror = v;
                    // Mirror cells can't also be cloze targets
                    if (v) cell.isCloze = false;
                    this.updateCellEl(idx);
                    this.renderInspector();
                });
            });

        // ── Cloze target ──
        new Setting(this.inspectorEl)
            .setName('Cloze target')
            .setDesc('Show as ? during review')
            .addToggle(t => {
                t.setValue(cell.isCloze);
                t.onChange(v => {
                    cell.isCloze = v;
                    if (v) cell.isMirror = false;
                    this.updateCellEl(idx);
                    this.renderInspector();
                });
            });

        if (cell.isCloze) {
            new Setting(this.inspectorEl)
                .setName('Answers')
                .setDesc('Comma-separated (e.g. Hydrogen, H)')
                .addText(t => {
                    t.setValue(cell.clozeAnswers);
                    t.onChange(v => { cell.clozeAnswers = v; });
                });

            new Setting(this.inspectorEl)
                .setName('Notes')
                .setDesc('Shown on incorrect screen')
                .addText(t => {
                    t.setValue(cell.clozeNotes);
                    t.onChange(v => { cell.clozeNotes = v; });
                });

            // ── Mirror data — one field per named slot ──────────────────────
            this.mirrorSlotContainerEl = this.inspectorEl.createDiv();
            this.renderMirrorSlots(cell);
        }
    }

    private renderMirrorSlots(cell: PainterCell) {
        if (!this.mirrorSlotContainerEl) return;
        this.mirrorSlotContainerEl.empty();

        const vars = this.state.mirrorVars;
        if (vars.length === 0) {
            this.mirrorSlotContainerEl.createEl('small', {
                text: 'Define Mirror slots (comma-separated names above) to enter per-slot values here.',
                attr: { style: 'display:block; color:var(--text-faint); margin: 6px 0; font-size:0.8em;' }
            });
            return;
        }

        this.mirrorSlotContainerEl.createEl('small', {
            text: 'Mirror info (shown in ◈ cells when this cloze is active)',
            attr: { style: 'display:block; font-weight:600; margin: 8px 0 4px;' }
        });

        const existing = cell.mirrorData ? cell.mirrorData.split('\n') : [];
        const slotInputs: HTMLInputElement[] = [];
        const saveValues = () => {
            cell.mirrorData = slotInputs.map(i => i.value.trim()).join('\n');
        };

        vars.forEach((name, i) => {
            const row = this.mirrorSlotContainerEl!.createDiv({ cls: 'gi-mirror-slot-row' });
            row.createEl('label', {
                text: name,
                attr: { style: 'font-size:0.8em; color:var(--text-muted); min-width:70px; flex-shrink:0;' }
            });
            const inp = row.createEl('input', { type: 'text' });
            inp.value = existing[i] ?? '';
            inp.placeholder = `value for "${name}"`;
            inp.style.flex = '1';
            inp.oninput = () => saveValues();
            slotInputs.push(inp);
        });
    }

    // ── Palette ────────────────────────────────────────────────────────────

    private renderPalette() {
        if (!this.paletteEl) return;
        this.paletteEl.empty();

        this.paletteEl.createEl('h4', { text: 'Brush Palette', attr: { style: 'margin: 0 0 8px 0;' } });

        const swatchRow = this.paletteEl.createDiv({ cls: 'gi-palette-swatches' });

        this.state.categories.forEach(cat => {
            const btn = swatchRow.createEl('button', { cls: 'gi-painter-swatch' });
            btn.dataset.cat = cat.name;
            btn.createSpan({ cls: 'gi-swatch-color', attr: { style: cat.css } });
            btn.createSpan({ text: cat.name });
            const isActive = this.state.brushMode === 'category' && this.state.activeBrush === cat.name;
            btn.toggleClass('gi-brush-active', isActive);
            btn.onclick = () => {
                // Re-clicking the active brush deselects it (back to select mode)
                if (this.state.brushMode === 'category' && this.state.activeBrush === cat.name) {
                    this.state.brushMode = 'none';
                    this.state.activeBrush = null;
                    this.gridEl?.removeClass('gi-canvas--painting');
                } else {
                    this.state.brushMode = 'category';
                    this.state.activeBrush = cat.name;
                    this.gridEl?.addClass('gi-canvas--painting');
                }
                this.renderPalette();
            };

            const del = btn.createSpan({ text: '×', cls: 'gi-swatch-delete' });
            del.onclick = (e) => {
                e.stopPropagation();
                this.state.categories = this.state.categories.filter(c => c.name !== cat.name);
                this.state.cells.forEach(c => { if (c.category === cat.name) c.category = null; });
                if (this.state.activeBrush === cat.name) {
                    this.state.activeBrush = null;
                    this.state.brushMode = 'none';
                }
                this.renderPalette();
                this.renderGrid();
            };
        });

        const toolRow = this.paletteEl.createDiv({ cls: 'gi-palette-tools' });

        const eraserBtn = toolRow.createEl('button', { text: 'Eraser', cls: 'gi-painter-swatch' });
        eraserBtn.toggleClass('gi-brush-active', this.state.brushMode === 'eraser');
        eraserBtn.onclick = () => {
            // Re-clicking the active eraser returns to select mode
            if (this.state.brushMode === 'eraser') {
                this.state.brushMode = 'none';
                this.gridEl?.removeClass('gi-canvas--painting');
            } else {
                this.state.brushMode = 'eraser';
                this.state.activeBrush = null;
                this.gridEl?.addClass('gi-canvas--painting');
            }
            this.renderPalette();
        };

        // 3-state span mode button: off → expand (green) → shrink (red) → off
        const spanLabels: Record<string, string> = {
            off:    '⤢ Span: off',
            expand: '⤢ Span: grow',
            shrink: '⤡ Span: shrink',
        };
        const spanBtn = toolRow.createEl('button', { text: spanLabels[this.state.spanMode], cls: 'gi-painter-swatch gi-span-mode-btn' });
        spanBtn.dataset.spanMode = this.state.spanMode;
        spanBtn.title = 'Cycle: off → grow (click green) → shrink (click red) → off';
        spanBtn.onclick = () => {
            const cycle: Record<'off' | 'expand' | 'shrink', 'off' | 'expand' | 'shrink'> = { off: 'expand', expand: 'shrink', shrink: 'off' };
            this.state.spanMode = cycle[this.state.spanMode];
            this.renderPalette();
            if (this.state.selectedIndex >= 0) this.enterFocusMode(this.state.selectedIndex);
            else this.renderGrid();
        };

        const modeLabel = this.paletteEl.createDiv({ cls: 'gi-palette-mode-label' });
        if (this.state.brushMode === 'category') modeLabel.setText(`Painting: "${this.state.activeBrush}"`);
        else if (this.state.brushMode === 'eraser') modeLabel.setText('Eraser active');
        else if (this.state.spanMode === 'expand') modeLabel.setText('Grow: click a green cell to expand selection');
        else if (this.state.spanMode === 'shrink') modeLabel.setText('Shrink: click a red cell to contract selection');
        else modeLabel.setText('Click any cell to select and edit it');

        const addArea = this.paletteEl.createDiv({ cls: 'gi-palette-add-area' });
        const addBtn = addArea.createEl('button', { text: '+ Add Category', cls: 'mod-ghost' });
        addBtn.onclick = () => this.openAddCategoryDialog(addArea, addBtn);
    }

    private openAddCategoryDialog(container: HTMLElement, triggerBtn: HTMLElement) {
        triggerBtn.style.display = 'none';
        const form = container.createDiv({ cls: 'gi-add-category-form' });

        form.createEl('small', { text: 'Name', attr: { style: 'display:block; margin-bottom:2px;' } });
        const nameInput = form.createEl('input', { type: 'text', placeholder: 'e.g. alkali' });
        nameInput.style.width = '100%';

        form.createEl('small', { text: 'CSS', attr: { style: 'display:block; margin:6px 0 2px;' } });
        const cssInput = form.createEl('input', {
            type: 'text',
            placeholder: 'background:#ff6b6b; color:white;'
        });
        cssInput.style.width = '100%';

        const errorSpan = form.createSpan({ cls: 'gi-add-category-error' });
        const btnRow = form.createDiv({ attr: { style: 'display:flex; gap:6px; margin-top:8px;' } });

        const addBtn = btnRow.createEl('button', { text: 'Add', cls: 'mod-cta' });
        addBtn.onclick = () => {
            const name = nameInput.value.trim();
            if (!name) { errorSpan.setText('Name cannot be empty.'); return; }
            if (this.state.categories.some(c => c.name === name)) {
                errorSpan.setText(`"${name}" already exists.`);
                return;
            }
            this.state.categories.push({ name, css: cssInput.value.trim() });
            form.remove();
            triggerBtn.style.display = '';
            this.renderPalette();
            this.renderInspector();
        };

        btnRow.createEl('button', { text: 'Cancel', cls: 'mod-ghost' }).onclick = () => {
            form.remove();
            triggerBtn.style.display = '';
        };

        nameInput.focus();
    }

    // ── Load from card data ────────────────────────────────────────────────

    private loadFromCardData(cardData: any) {
        this.state.title = cardData.title || '';
        this.state.deck = cardData.deck || '';
        this.state.cardId = cardData.id || '';
        this.state.columns = cardData.columns || 18;

        // Load named categories, filtering out auto-generated ones
        const rawCats: Record<string, string> = cardData.categories || {};
        this.state.categories = Object.entries(rawCats)
            .filter(([name]) => !AUTO_CAT_PATTERN.test(name))
            .map(([name, css]) => ({ name, css: css as string }));

        const dataRows: any[][] = Array.isArray(cardData.data) ? cardData.data : [];
        this.state.rows = Math.max(dataRows.length, 1);
        this.initCells();

        const covered = new Set<number>();
        // Maps "${rIdx}-${arrayIdx}" → cellIndex for cloze coord lookup
        const arrayIdxToCellIdx = new Map<string, number>();

        dataRows.forEach((row: any[], rIdx: number) => {
            if (!Array.isArray(row)) return;
            let cIdx = 0;   // visual column
            let aIdx = 0;   // index within this row's data array

            row.forEach((cellStr: any) => {
                // Skip columns already covered by a span from above
                while (cIdx < this.state.columns &&
                       covered.has(cellIndex(this.state.columns, rIdx, cIdx))) {
                    cIdx++;
                }
                if (cIdx >= this.state.columns) return;

                const parts = String(cellStr).split(':');
                const val = parts[0] ?? '';
                const cat = parts[1] || null;
                const colSpan = Math.max(1, parseInt(parts[2] ?? '1') || 1);
                const rowSpan = Math.max(1, parseInt(parts[3] ?? '1') || 1);

                const idx = cellIndex(this.state.columns, rIdx, cIdx);
                if (idx < this.state.cells.length) {
                    const cell = this.state.cells[idx]!;
                    cell.value = val;
                    cell.colSpan = Math.min(colSpan, this.state.columns - cIdx);
                    cell.rowSpan = Math.min(rowSpan, this.state.rows - rIdx);

                    // Auto-generated per-cell category → convert back to customCss
                    if (cat && AUTO_CAT_PATTERN.test(cat) && rawCats[cat]) {
                        cell.customCss = rawCats[cat] as string;
                        cell.category = null;
                    } else {
                        cell.category = cat;
                    }

                    // Mark covered positions
                    for (let dr = 0; dr < cell.rowSpan; dr++) {
                        for (let dc = 0; dc < cell.colSpan; dc++) {
                            if (dr === 0 && dc === 0) continue;
                            const sr = rIdx + dr, sc = cIdx + dc;
                            if (sr < this.state.rows && sc < this.state.columns) {
                                covered.add(cellIndex(this.state.columns, sr, sc));
                            }
                        }
                    }

                    arrayIdxToCellIdx.set(`${rIdx}-${aIdx}`, idx);
                }

                cIdx += colSpan;
                aIdx++;
            });
        });

        // Load clozes using array-index coords
        const clozes: any[] = Array.isArray(cardData.clozes) ? cardData.clozes : [];
        clozes.forEach((cloze: any) => {
            if (!Array.isArray(cloze.coords) || cloze.coords.length < 2) return;
            const [r, aIdx] = cloze.coords;
            const cellIdx = arrayIdxToCellIdx.get(`${r}-${aIdx}`);
            if (cellIdx === undefined) return;
            const cell = this.state.cells[cellIdx];
            if (!cell) return;
            cell.isCloze = true;
            cell.clozeAnswers = Array.isArray(cloze.answers)
                ? cloze.answers.join(', ')
                : (String(cloze.answers || ''));
            cell.clozeNotes = cloze.notes || '';
            cell.mirrorData = Array.isArray(cloze.mirrorData)
                ? cloze.mirrorData.join('\n')
                : (cloze.mirrorData || '');
        });

        // Load mirror variable slot names
        this.state.mirrorVars = Array.isArray(cardData.mirrorVars) ? cardData.mirrorVars : [];

        // Load mirror cells (stored as separate array in JSON)
        const mirrors: any[] = Array.isArray(cardData.mirrors) ? cardData.mirrors : [];
        mirrors.forEach((m: any) => {
            if (!Array.isArray(m.coords) || m.coords.length < 2) return;
            const [r, aIdx] = m.coords;
            const cellIdx = arrayIdxToCellIdx.get(`${r}-${aIdx}`);
            if (cellIdx === undefined) return;
            const cell = this.state.cells[cellIdx];
            if (cell) cell.isMirror = true;
        });
    }

    // ── Generate JSON ──────────────────────────────────────────────────────

    private generateJSON(): object {
        const { state } = this;
        const shadowed = computeShadowedIndices(state);
        const data: string[][] = [];
        const clozes: object[] = [];
        const categoriesObj: Record<string, string> = {};

        // Named categories
        for (const cat of state.categories) {
            categoriesObj[cat.name] = cat.css;
        }

        for (let r = 0; r < state.rows; r++) {
            const rowData: string[] = [];
            let arrayIdx = 0;

            for (let c = 0; c < state.columns; c++) {
                const idx = cellIndex(state.columns, r, c);
                if (shadowed.has(idx)) continue;
                const cell = state.cells[idx]!;

                let catKey = cell.category ?? '';

                // Per-cell CSS → auto-generate category keyed by position
                if (cell.customCss) {
                    const autoKey = `cell-${r}-${c}`;
                    const baseCss = cell.category
                        ? (state.categories.find(cat => cat.name === cell.category)?.css ?? '')
                        : '';
                    categoriesObj[autoKey] = (baseCss ? baseCss + '; ' : '') + cell.customCss;
                    catKey = autoKey;
                }

                rowData.push(`${cell.value}:${catKey}:${cell.colSpan}:${cell.rowSpan}`);

                if (cell.isCloze) {
                    const answers = cell.clozeAnswers
                        .split(',').map(s => s.trim()).filter(Boolean);
                    const entry: any = {
                        id: `cloze-${r}-${arrayIdx}`,
                        coords: [r, arrayIdx],
                        answers
                    };
                    if (cell.clozeNotes) entry.notes = cell.clozeNotes;
                    if (cell.mirrorData.trim()) {
                        entry.mirrorData = cell.mirrorData.split('\n').map(s => s.trim()).filter(Boolean);
                    }
                    clozes.push(entry);
                }

                arrayIdx++;
            }
            data.push(rowData);
        }

        const result: any = {
            type: 'grid',
            title: state.title,
            columns: state.columns,
            data,
        };
        if (state.cardId) result.id = state.cardId;
        if (state.deck) result.deck = state.deck;
        if (Object.keys(categoriesObj).length > 0) result.categories = categoriesObj;
        if (clozes.length > 0) result.clozes = clozes;

        // Emit mirror cell coords
        const mirrors: object[] = [];
        for (let r = 0; r < state.rows; r++) {
            let arrayIdx = 0;
            for (let c = 0; c < state.columns; c++) {
                const idx = cellIndex(state.columns, r, c);
                if (shadowed.has(idx)) continue;
                const cell = state.cells[idx]!;
                if (cell.isMirror) mirrors.push({ coords: [r, arrayIdx] });
                arrayIdx++;
            }
        }
        if (mirrors.length > 0) result.mirrors = mirrors;
        if (state.mirrorVars.length > 0) result.mirrorVars = state.mirrorVars;

        return result;
    }

    private onCopyJSON() {
        const json = JSON.stringify(this.generateJSON(), null, 2);
        const fallback = () => {
            const ta = document.createElement('textarea');
            ta.value = json;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            new Notice('JSON copied to clipboard!');
        };
        if (navigator.clipboard) {
            navigator.clipboard.writeText(json).then(
                () => new Notice('JSON copied to clipboard!'),
                fallback
            );
        } else {
            fallback();
        }
    }

    // ── Save to file (edit mode) ───────────────────────────────────────────

    private async saveToFile() {
        if (!this.editContext) return;
        const { filePath, originalSource } = this.editContext;

        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            new Notice('Could not find the source file.');
            return;
        }

        const newSource = JSON.stringify(this.generateJSON(), null, 2);
        let saved = false;

        await this.app.vault.process(file, (data) => {
            const regex = /```inventory-card\s*([\s\S]*?)\s*```/g;
            return data.replace(regex, (match, src) => {
                // Try matching by card ID first (most reliable)
                const matchById = !!(this.state.cardId && (() => {
                    try { return JSON.parse(src)?.id === this.state.cardId; } catch { return false; }
                })());
                // Fall back to matching by the exact original source text
                const matchBySource = src.trim() === originalSource.trim();

                if (matchById || matchBySource) {
                    saved = true;
                    return '```inventory-card\n' + newSource + '\n```';
                }
                return match;
            });
        });

        if (saved) {
            new Notice('Card saved!');
            this.close();
        } else {
            new Notice('No matching card found. Add an "id" field to your JSON for reliable saves.');
        }
    }
}
