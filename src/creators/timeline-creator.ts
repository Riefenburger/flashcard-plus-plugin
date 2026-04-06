import { App, Modal, Notice, TFile } from 'obsidian';
import { appendCardToFile } from '../utils/append-card';

interface TimelineBand {
    label: string;
    start: number;
    end: number;
    color: string;
}

interface TimelineCloze {
    id: string;
    front: string;
    back: string;   // comma-separated
    year: number;
    notes: string;
}

export class TimelineCreatorModal extends Modal {
    private targetFile: TFile | null;
    private title = '';
    private deck = '';
    private cardId = '';
    private startYear = -540;
    private endYear = 0;
    private unit = 'Ma';
    private bands: TimelineBand[] = [];
    private clozes: TimelineCloze[] = [];

    constructor(app: App, targetFile: TFile | null) {
        super(app);
        this.targetFile = targetFile;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-creator-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('grand-inventory-modal-window');

        contentEl.createEl('h2', { text: 'New Timeline Card' });

        // ── Meta ──
        const metaRow = contentEl.createDiv({ cls: 'gi-painter-meta-row' });

        const titleWrap = metaRow.createDiv({ cls: 'gi-painter-field' });
        titleWrap.createEl('label', { text: 'Title' });
        const titleInput = titleWrap.createEl('input', { type: 'text', attr: { placeholder: 'e.g. Geologic Time Scale' } });
        titleInput.oninput = () => { this.title = titleInput.value; };

        const deckWrap = metaRow.createDiv({ cls: 'gi-painter-field' });
        deckWrap.createEl('label', { text: 'Deck' });
        const deckInput = deckWrap.createEl('input', { type: 'text', attr: { placeholder: 'e.g. Earth Science' } });
        deckInput.oninput = () => { this.deck = deckInput.value; };

        const idWrap = metaRow.createDiv({ cls: 'gi-painter-field gi-painter-field--sm' });
        idWrap.createEl('label', { text: 'ID' });
        const idInput = idWrap.createEl('input', { type: 'text', attr: { placeholder: 'e.g. geo-time' } });
        idInput.oninput = () => { this.cardId = idInput.value; };

        // ── Range + unit ──
        const rangeRow = contentEl.createDiv({ cls: 'gi-painter-meta-row' });

        const startWrap = rangeRow.createDiv({ cls: 'gi-painter-field gi-painter-field--sm' });
        startWrap.createEl('label', { text: 'Start' });
        const startInput = startWrap.createEl('input', { type: 'number', attr: { placeholder: '-540' } });
        startInput.value = String(this.startYear);
        startInput.oninput = () => { this.startYear = parseFloat(startInput.value) || 0; };

        const endWrap = rangeRow.createDiv({ cls: 'gi-painter-field gi-painter-field--sm' });
        endWrap.createEl('label', { text: 'End' });
        const endInput = endWrap.createEl('input', { type: 'number', attr: { placeholder: '0' } });
        endInput.value = String(this.endYear);
        endInput.oninput = () => { this.endYear = parseFloat(endInput.value) || 0; };

        const unitWrap = rangeRow.createDiv({ cls: 'gi-painter-field gi-painter-field--sm' });
        unitWrap.createEl('label', { text: 'Unit' });
        const unitInput = unitWrap.createEl('input', { type: 'text', attr: { placeholder: 'Ma / BCE / CE' } });
        unitInput.value = this.unit;
        unitInput.oninput = () => { this.unit = unitInput.value; };

        // ── Bands ──
        contentEl.createEl('h4', { text: 'Bands (background segments)', attr: { style: 'margin: 16px 0 6px;' } });
        const bandsEl = contentEl.createDiv({ cls: 'gi-tl-bands-list' });
        this.renderBands(bandsEl);
        contentEl.createEl('button', { text: '+ Add Band', cls: 'mod-ghost' }).onclick = () => {
            this.bands.push({ label: '', start: this.startYear, end: this.endYear, color: '#8ecae6' });
            this.renderBands(bandsEl);
        };

        // ── Clozes ──
        contentEl.createEl('h4', { text: 'Clozes', attr: { style: 'margin: 16px 0 6px;' } });
        const clozesEl = contentEl.createDiv({ cls: 'gi-tl-clozes-list' });
        this.renderClozes(clozesEl);
        contentEl.createEl('button', { text: '+ Add Cloze', cls: 'mod-ghost' }).onclick = () => {
            this.clozes.push({
                id: `tl-${Date.now()}`,
                front: '',
                back: '',
                year: Math.round((this.startYear + this.endYear) / 2),
                notes: '',
            });
            this.renderClozes(clozesEl);
        };

        // ── Save ──
        const footer = contentEl.createDiv({ cls: 'gi-painter-footer' });
        const saveBtn = footer.createEl('button', { text: 'Save to Note', cls: 'mod-cta' });
        saveBtn.style.width = '100%';
        saveBtn.onclick = () => this.save();
    }

    onClose() {
        this.contentEl.empty();
    }

    private renderBands(container: HTMLElement) {
        container.empty();
        this.bands.forEach((band, i) => {
            const row = container.createDiv({ cls: 'gi-tl-band-row' });

            const colorInput = row.createEl('input', { type: 'color' });
            colorInput.value = band.color;
            colorInput.oninput = () => { band.color = colorInput.value; };

            const labelInput = row.createEl('input', { type: 'text', attr: { placeholder: 'Label', style: 'flex:1;' } });
            labelInput.value = band.label;
            labelInput.oninput = () => { band.label = labelInput.value; };

            const startInput = row.createEl('input', { type: 'number', attr: { placeholder: 'Start', style: 'width:70px;' } });
            startInput.value = String(band.start);
            startInput.oninput = () => { band.start = parseFloat(startInput.value) || 0; };

            const endInput = row.createEl('input', { type: 'number', attr: { placeholder: 'End', style: 'width:70px;' } });
            endInput.value = String(band.end);
            endInput.oninput = () => { band.end = parseFloat(endInput.value) || 0; };

            const del = row.createEl('button', { text: '×', cls: 'mod-ghost' });
            del.onclick = () => { this.bands.splice(i, 1); this.renderBands(container); };
        });
    }

    private renderClozes(container: HTMLElement) {
        container.empty();
        this.clozes.forEach((cloze, i) => {
            const row = container.createDiv({ cls: 'gi-cloze-row' });

            const qRow = row.createDiv({ cls: 'gi-pin-form-row' });
            qRow.createEl('label', { text: 'Question' });
            const frontInput = qRow.createEl('input', { type: 'text', attr: { style: 'width:100%;' } });
            frontInput.value = cloze.front;
            frontInput.oninput = () => { cloze.front = frontInput.value; };

            const aRow = row.createDiv({ cls: 'gi-pin-form-row' });
            aRow.createEl('label', { text: 'Answer(s)' });
            const backInput = aRow.createEl('input', { type: 'text', attr: { placeholder: 'comma-separated', style: 'width:100%;' } });
            backInput.value = cloze.back;
            backInput.oninput = () => { cloze.back = backInput.value; };

            const yRow = row.createDiv({ cls: 'gi-pin-form-row' });
            yRow.createEl('label', { text: 'Exact year' });
            const yearInput = yRow.createEl('input', { type: 'number', attr: { style: 'width:120px;' } });
            yearInput.value = String(cloze.year);
            yearInput.oninput = () => { cloze.year = parseFloat(yearInput.value) || 0; };

            const nRow = row.createDiv({ cls: 'gi-pin-form-row' });
            nRow.createEl('label', { text: 'Notes' });
            const notesInput = nRow.createEl('input', { type: 'text', attr: { style: 'width:100%;' } });
            notesInput.value = cloze.notes;
            notesInput.oninput = () => { cloze.notes = notesInput.value; };

            const del = row.createEl('button', { text: '× Remove', cls: 'mod-ghost' });
            del.style.marginTop = '6px';
            del.onclick = () => { this.clozes.splice(i, 1); this.renderClozes(container); };
        });
    }

    private generateJSON(): object {
        const result: any = {
            type: 'timeline',
            title: this.title,
            start: this.startYear,
            end: this.endYear,
            unit: this.unit,
            bands: this.bands,
            clozes: this.clozes.map(c => ({
                id: c.id,
                front: c.front,
                back: c.back.split(',').map((s: string) => s.trim()).filter(Boolean),
                year: c.year,
                ...(c.notes ? { notes: c.notes } : {}),
            })),
        };
        if (this.cardId.trim()) result.id = this.cardId.trim();
        if (this.deck.trim()) result.deck = this.deck.trim();
        return result;
    }

    private async save() {
        if (this.clozes.length === 0) {
            new Notice('Add at least one cloze before saving.');
            return;
        }
        const ok = await appendCardToFile(this.app, this.generateJSON(), this.targetFile);
        if (ok) this.close();
    }
}
