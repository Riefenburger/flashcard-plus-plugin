import { App, Modal, Notice, TFile } from 'obsidian';
import { attachPanZoom, createSVGPin, removeSVGPin, PanZoomHandle } from './utils/svg-pan-zoom';
import { appendCardToFile } from './utils/append-card';

interface SvgCloze {
    id: string;
    x: number;
    y: number;
    front: string;
    back: string;       // comma-separated at authoring time, split at export
    notes: string;
    pinEl: SVGGElement | null;
}

export class SVGPainterModal extends Modal {
    private targetFile: TFile | null;
    private title = '';
    private deck = '';
    private cardId = '';
    private svgPath = '';
    private svgEl: SVGSVGElement | null = null;
    private panZoom: PanZoomHandle | null = null;
    private clozes: SvgCloze[] = [];
    private svgFiles: TFile[] = [];

    // DOM refs
    private svgContainerEl: HTMLElement | null = null;
    private overlayEl: HTMLElement | null = null;
    private clozeListEl: HTMLElement | null = null;
    private pinFormEl: HTMLElement | null = null;

    constructor(app: App, targetFile: TFile | null) {
        super(app);
        this.targetFile = targetFile;
        this.svgFiles = app.vault.getFiles().filter(
            f => f.extension.toLowerCase() === 'svg'
        );
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-creator-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('grand-inventory-modal-window');

        contentEl.createEl('h2', { text: 'New SVG Diagram Card' });

        // ── Meta ──
        const metaRow = contentEl.createDiv({ cls: 'gi-painter-meta-row' });

        const titleWrap = metaRow.createDiv({ cls: 'gi-painter-field' });
        titleWrap.createEl('label', { text: 'Title' });
        const titleInput = titleWrap.createEl('input', { type: 'text' });
        titleInput.placeholder = 'e.g. Skeletal System';
        titleInput.oninput = () => { this.title = titleInput.value; };

        const deckWrap = metaRow.createDiv({ cls: 'gi-painter-field' });
        deckWrap.createEl('label', { text: 'Deck' });
        const deckInput = deckWrap.createEl('input', { type: 'text' });
        deckInput.placeholder = 'e.g. Anatomy';
        deckInput.oninput = () => { this.deck = deckInput.value; };

        const idWrap = metaRow.createDiv({ cls: 'gi-painter-field gi-painter-field--sm' });
        idWrap.createEl('label', { text: 'ID' });
        const idInput = idWrap.createEl('input', { type: 'text' });
        idInput.placeholder = 'e.g. skeleton-01';
        idInput.oninput = () => { this.cardId = idInput.value; };

        // ── SVG file picker ──
        const pickerRow = contentEl.createDiv({ cls: 'gi-painter-dim-row' });
        const pickerWrap = pickerRow.createDiv({ cls: 'gi-painter-field' });
        pickerWrap.createEl('label', { text: 'SVG File' });

        if (this.svgFiles.length === 0) {
            pickerWrap.createEl('p', {
                text: 'No .svg files found in vault.',
                attr: { style: 'color: var(--text-error); font-size: 0.9em;' }
            });
        } else {
            const select = pickerWrap.createEl('select');
            select.style.width = '100%';
            select.createEl('option', { text: '— pick an SVG file —', value: '' });
            this.svgFiles.forEach(f => select.createEl('option', { text: f.path, value: f.path }));
            select.onchange = () => {
                this.svgPath = select.value;
                if (this.svgPath) this.loadAndRenderSVG(this.svgPath);
            };
        }

        // ── Hint ──
        contentEl.createEl('p', {
            text: 'Pan: drag. Zoom: scroll. Drop a pin: click on the diagram.',
            attr: { style: 'color: var(--text-muted); font-size: 0.85em; margin: 8px 0;' }
        });

        // ── SVG viewer ──
        const viewerWrap = contentEl.createDiv({ cls: 'gi-svg-viewer-wrap' });
        this.svgContainerEl = viewerWrap.createDiv({ cls: 'gi-svg-container' });
        this.overlayEl = viewerWrap.createDiv({ cls: 'gi-svg-overlay' });

        // ── Cloze list ──
        this.clozeListEl = contentEl.createDiv({ cls: 'gi-cloze-list' });

        // ── Footer ──
        const footer = contentEl.createDiv({ cls: 'gi-painter-footer' });
        const saveBtn = footer.createEl('button', { text: 'Save to Note', cls: 'mod-cta' });
        saveBtn.style.width = '100%';
        saveBtn.onclick = () => this.save();
    }

    onClose() {
        this.panZoom?.destroy();
        this.contentEl.empty();
    }

    // ── SVG loading ────────────────────────────────────────────────────────

    private async loadAndRenderSVG(path: string) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            new Notice(`Could not open "${path}"`);
            return;
        }

        const content = await this.app.vault.read(file);
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'image/svg+xml');
        const parsed = doc.querySelector('svg');
        if (!parsed) {
            new Notice('Could not parse the SVG file.');
            return;
        }

        // Detach old pan+zoom
        this.panZoom?.destroy();
        this.panZoom = null;

        // Clear old content but keep existing pins' cloze data
        this.clozes.forEach(c => { c.pinEl = null; });

        if (!this.svgContainerEl) return;
        this.svgContainerEl.empty();

        // Strip fixed width/height so it fills the container
        parsed.removeAttribute('width');
        parsed.removeAttribute('height');
        parsed.style.width = '100%';
        parsed.style.height = '100%';
        parsed.style.display = 'block';

        // Import node into our document
        const svgEl = document.adoptNode(parsed) as SVGSVGElement;
        this.svgContainerEl.appendChild(svgEl);
        this.svgEl = svgEl;

        // Re-draw pins for any existing clozes
        this.clozes.forEach(c => {
            c.pinEl = createSVGPin(svgEl, c.x, c.y, '?');
        });

        // Attach pan+zoom with pin-drop callback
        this.panZoom = attachPanZoom(svgEl, (svgX, svgY) => {
            this.dropPin(svgX, svgY);
        });
    }

    // ── Pin drop ───────────────────────────────────────────────────────────

    private dropPin(svgX: number, svgY: number) {
        if (!this.svgEl) return;

        // Create a temporary pin while the form is open
        const tempPin = createSVGPin(this.svgEl, svgX, svgY, '?');

        this.openPinForm(svgX, svgY, (cloze) => {
            if (!cloze) {
                // User cancelled — remove the temp pin
                removeSVGPin(tempPin);
                return;
            }
            // Replace temp pin with a permanent labeled one
            removeSVGPin(tempPin);
            const pin = createSVGPin(this.svgEl!, svgX, svgY, '?');
            pin.addEventListener('click', () => this.editCloze(cloze));
            cloze.pinEl = pin;
            this.clozes.push(cloze);
            this.renderClozeList();
        });
    }

    // ── Pin form (HTML overlay, not SVG foreignObject) ─────────────────────

    private openPinForm(
        svgX: number,
        svgY: number,
        onDone: (cloze: SvgCloze | null) => void
    ) {
        if (!this.overlayEl) return;

        // Remove any existing open form
        this.pinFormEl?.remove();

        const form = this.overlayEl.createDiv({ cls: 'gi-pin-form' });
        this.pinFormEl = form;

        form.createEl('strong', { text: `Pin at (${Math.round(svgX)}, ${Math.round(svgY)})` });

        const qRow = form.createDiv({ cls: 'gi-pin-form-row' });
        qRow.createEl('label', { text: 'Question' });
        const frontInput = qRow.createEl('input', { type: 'text', placeholder: 'e.g. Name this bone' });
        frontInput.style.width = '100%';
        setTimeout(() => frontInput.focus(), 50);

        const aRow = form.createDiv({ cls: 'gi-pin-form-row' });
        aRow.createEl('label', { text: 'Answers' });
        const backInput = aRow.createEl('input', { type: 'text', placeholder: 'e.g. Femur, femur' });
        backInput.style.width = '100%';

        const nRow = form.createDiv({ cls: 'gi-pin-form-row' });
        nRow.createEl('label', { text: 'Notes (optional)' });
        const notesInput = nRow.createEl('input', { type: 'text' });
        notesInput.style.width = '100%';

        const btnRow = form.createDiv({ attr: { style: 'display:flex; gap:8px; margin-top:10px;' } });

        const addBtn = btnRow.createEl('button', { text: 'Add Pin', cls: 'mod-cta' });
        addBtn.onclick = () => {
            form.remove();
            this.pinFormEl = null;
            onDone({
                id: `sv-${Date.now()}`,
                x: svgX,
                y: svgY,
                front: frontInput.value.trim(),
                back: backInput.value.trim(),
                notes: notesInput.value.trim(),
                pinEl: null,
            });
        };

        const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'mod-ghost' });
        cancelBtn.onclick = () => {
            form.remove();
            this.pinFormEl = null;
            onDone(null);
        };

        // Allow Enter to confirm
        [frontInput, backInput, notesInput].forEach(inp => {
            inp.onkeydown = (e) => { if (e.key === 'Enter') addBtn.click(); };
        });
    }

    private editCloze(cloze: SvgCloze) {
        // Simple: re-open the form pre-filled, replace the cloze on save
        if (!this.overlayEl) return;
        this.pinFormEl?.remove();

        const form = this.overlayEl.createDiv({ cls: 'gi-pin-form' });
        this.pinFormEl = form;

        form.createEl('strong', { text: 'Edit Pin' });

        const qRow = form.createDiv({ cls: 'gi-pin-form-row' });
        qRow.createEl('label', { text: 'Question' });
        const frontInput = qRow.createEl('input', { type: 'text' });
        frontInput.value = cloze.front;
        frontInput.style.width = '100%';
        setTimeout(() => frontInput.focus(), 50);

        const aRow = form.createDiv({ cls: 'gi-pin-form-row' });
        aRow.createEl('label', { text: 'Answers' });
        const backInput = aRow.createEl('input', { type: 'text' });
        backInput.value = cloze.back;
        backInput.style.width = '100%';

        const nRow = form.createDiv({ cls: 'gi-pin-form-row' });
        nRow.createEl('label', { text: 'Notes (optional)' });
        const notesInput = nRow.createEl('input', { type: 'text' });
        notesInput.value = cloze.notes;
        notesInput.style.width = '100%';

        const btnRow = form.createDiv({ attr: { style: 'display:flex; gap:8px; margin-top:10px;' } });

        btnRow.createEl('button', { text: 'Save', cls: 'mod-cta' }).onclick = () => {
            cloze.front = frontInput.value.trim();
            cloze.back = backInput.value.trim();
            cloze.notes = notesInput.value.trim();
            form.remove();
            this.pinFormEl = null;
            this.renderClozeList();
        };

        btnRow.createEl('button', { text: 'Delete Pin', cls: 'mod-warning' }).onclick = () => {
            if (cloze.pinEl) removeSVGPin(cloze.pinEl);
            this.clozes = this.clozes.filter(c => c.id !== cloze.id);
            form.remove();
            this.pinFormEl = null;
            this.renderClozeList();
        };

        btnRow.createEl('button', { text: 'Cancel', cls: 'mod-ghost' }).onclick = () => {
            form.remove();
            this.pinFormEl = null;
        };
    }

    // ── Cloze list ─────────────────────────────────────────────────────────

    private renderClozeList() {
        if (!this.clozeListEl) return;
        this.clozeListEl.empty();

        if (this.clozes.length === 0) {
            this.clozeListEl.createEl('p', {
                text: 'No pins yet. Click the diagram to add one.',
                attr: { style: 'color: var(--text-muted); font-size: 0.9em;' }
            });
            return;
        }

        this.clozeListEl.createEl('h4', {
            text: `Pins (${this.clozes.length})`,
            attr: { style: 'margin: 12px 0 6px;' }
        });

        this.clozes.forEach((c) => {
            const row = this.clozeListEl!.createDiv({ cls: 'gi-cloze-list-row' });
            row.createEl('span', {
                text: c.front || '(no question)',
                attr: { style: 'flex: 1;' }
            });
            row.createEl('small', {
                text: `(${Math.round(c.x)}, ${Math.round(c.y)})`,
                attr: { style: 'color: var(--text-muted); margin: 0 8px;' }
            });
            const editBtn = row.createEl('button', { text: 'Edit', cls: 'mod-ghost' });
            editBtn.onclick = () => this.editCloze(c);
        });
    }

    // ── Export ─────────────────────────────────────────────────────────────

    private generateJSON(): object {
        const result: any = {
            type: 'svg',
            title: this.title,
            svgPath: this.svgPath,
            clozes: this.clozes.map(c => {
                const entry: any = {
                    id: c.id,
                    x: Math.round(c.x),
                    y: Math.round(c.y),
                    front: c.front,
                    back: c.back.split(',').map(s => s.trim()).filter(Boolean),
                };
                if (c.notes) entry.notes = c.notes;
                return entry;
            })
        };
        if (this.cardId.trim()) result.id = this.cardId.trim();
        if (this.deck.trim()) result.deck = this.deck.trim();
        return result;
    }

    private async save() {
        if (!this.svgPath) {
            new Notice('Please select an SVG file first.');
            return;
        }
        const ok = await appendCardToFile(this.app, this.generateJSON(), this.targetFile);
        if (ok) this.close();
    }
}
