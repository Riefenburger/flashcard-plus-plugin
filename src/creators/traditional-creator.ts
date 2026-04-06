import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { appendCardToFile } from '../utils/append-card';

interface ClozeRow {
    id: string;
    front: string;
    back: string;    // comma-separated
    notes: string;
    style: string;   // optional raw CSS applied to the card container during review
}

export interface TraditionalEditCtx {
    cardData: any;
    filePath: string;
    originalSource: string;
}

export class TraditionalCreatorModal extends Modal {
    private targetFile: TFile | null;
    private title = '';
    private deck = '';
    private cardId = '';
    private clozes: ClozeRow[] = [{ id: '', front: '', back: '', notes: '', style: '' }];
    private clozeListEl: HTMLElement | null = null;
    private editCtx: TraditionalEditCtx | null;

    constructor(app: App, targetFile: TFile | null, editCtx?: TraditionalEditCtx) {
        super(app);
        this.targetFile = targetFile;
        this.editCtx = editCtx ?? null;

        // Pre-populate from existing card data when editing
        if (editCtx) {
            const d = editCtx.cardData;
            this.title = d.title || '';
            this.deck = d.deck || '';
            this.cardId = d.id || '';
            this.clozes = (d.clozes || []).map((c: any) => ({
                id: c.id || '',
                front: c.front || '',
                back: Array.isArray(c.back) ? c.back.join(', ') : (c.back || ''),
                notes: c.notes || '',
                style: c.style || '',
            }));
            if (this.clozes.length === 0) {
                this.clozes = [{ id: '', front: '', back: '', notes: '', style: '' }];
            }
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-creator-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('grand-inventory-modal-window');

        contentEl.createEl('h2', { text: this.editCtx ? 'Edit Traditional Card' : 'New Traditional Card' });

        const titleSetting = new Setting(contentEl).setName('Title').addText(t => {
            t.setValue(this.title);
            t.setPlaceholder('e.g. Amino Acids');
            t.onChange(v => { this.title = v; });
        });
        // suppress unused warning — intentional
        void titleSetting;

        new Setting(contentEl).setName('Deck').addText(t => {
            t.setValue(this.deck);
            t.setPlaceholder('e.g. Biology');
            t.onChange(v => { this.deck = v; });
        });

        contentEl.createEl('h3', {
            text: 'Clozes',
            attr: { style: 'margin: 16px 0 8px;' }
        });

        this.clozeListEl = contentEl.createDiv({ cls: 'gi-cloze-list' });
        this.renderClozeList();

        const addBtn = contentEl.createEl('button', { text: '+ Add Cloze', cls: 'mod-ghost' });
        addBtn.style.marginBottom = '16px';
        addBtn.onclick = () => {
            this.clozes.push({ id: '', front: '', back: '', notes: '', style: '' });
            this.renderClozeList();
        };

        const saveBtn = contentEl.createEl('button', {
            text: this.editCtx ? 'Save Changes' : 'Save to Note',
            cls: 'mod-cta'
        });
        saveBtn.style.width = '100%';
        saveBtn.onclick = () => this.save();
    }

    private renderClozeList() {
        if (!this.clozeListEl) return;
        this.clozeListEl.empty();

        this.clozes.forEach((cloze, i) => {
            const row = this.clozeListEl!.createDiv({ cls: 'gi-cloze-row' });
            row.createEl('small', {
                text: `Cloze ${i + 1}`,
                attr: { style: 'font-weight:bold; display:block; margin-bottom:4px; color:var(--text-muted);' }
            });

            new Setting(row).setName('Question').addText(t => {
                t.setValue(cloze.front);
                t.setPlaceholder('e.g. What element has symbol Fe?');
                t.onChange(v => { cloze.front = v; });
            });

            new Setting(row).setName('Answers').setDesc('Comma-separated accepted answers').addText(t => {
                t.setValue(cloze.back);
                t.setPlaceholder('e.g. Iron, iron, Fe');
                t.onChange(v => { cloze.back = v; });
            });

            new Setting(row).setName('Notes').setDesc('Optional — shown on incorrect').addText(t => {
                t.setValue(cloze.notes);
                t.onChange(v => { cloze.notes = v; });
            });

            // Collapsed CSS style option
            const styleToggle = row.createEl('button', {
                text: cloze.style ? '▾ Card Style (set)' : '▸ Card Style (optional)',
                cls: 'mod-ghost gi-trad-style-toggle'
            });
            const styleArea = row.createDiv({ cls: 'gi-trad-style-area' });
            styleArea.style.display = cloze.style ? 'block' : 'none';
            const styleHint = styleArea.createEl('small', {
                text: 'CSS applied to the review card. e.g. background:#1e3a5f; color:#e0f0ff; border-left:4px solid #3b82f6;',
                attr: { style: 'display:block; color:var(--text-muted); margin-bottom:4px;' }
            });
            void styleHint;
            const styleTa = styleArea.createEl('textarea', { cls: 'gi-trad-style-input' });
            styleTa.value = cloze.style;
            styleTa.rows = 2;
            styleTa.oninput = () => { cloze.style = styleTa.value; };
            styleToggle.onclick = () => {
                const open = styleArea.style.display === 'none';
                styleArea.style.display = open ? 'block' : 'none';
                styleToggle.setText(open
                    ? (cloze.style ? '▾ Card Style (set)' : '▾ Card Style (optional)')
                    : (cloze.style ? '▸ Card Style (set)' : '▸ Card Style (optional)'));
            };

            if (this.clozes.length > 1) {
                const removeBtn = row.createEl('button', { text: 'Remove', cls: 'mod-warning' });
                removeBtn.style.marginTop = '4px';
                removeBtn.onclick = () => {
                    this.clozes.splice(i, 1);
                    this.renderClozeList();
                };
            }

            row.createEl('hr', { attr: { style: 'margin: 12px 0; opacity: 0.3;' } });
        });
    }

    private buildCardJson(): any {
        const cardJson: any = {
            id: this.cardId || `trad-${Date.now()}`,
            type: 'traditional',
            title: this.title,
            clozes: this.clozes.map((c, i) => {
                const entry: any = {
                    id: c.id || `c-${i}`,
                    front: c.front,
                    back: c.back.split(',').map((s: string) => s.trim()).filter(Boolean),
                };
                if (c.notes.trim()) entry.notes = c.notes.trim();
                if (c.style.trim()) entry.style = c.style.trim();
                return entry;
            })
        };
        if (this.deck.trim()) cardJson.deck = this.deck.trim();
        return cardJson;
    }

    private async save() {
        const cardJson = this.buildCardJson();

        if (this.editCtx) {
            // Edit mode: replace the existing block in-place
            const file = this.app.vault.getAbstractFileByPath(this.editCtx.filePath);
            if (!(file instanceof TFile)) {
                new Notice('Could not find the source file.');
                return;
            }
            const newBlock = '```inventory-card\n' + JSON.stringify(cardJson, null, 2) + '\n```';
            const oldBlock = '```inventory-card\n' + this.editCtx.originalSource + '\n```';
            await this.app.vault.process(file, content => {
                if (content.includes(oldBlock)) {
                    return content.replace(oldBlock, newBlock);
                }
                // Fallback: append if original block not found (shouldn't happen)
                new Notice('Original block not found — appending instead.');
                return content + '\n\n' + newBlock + '\n';
            });
            new Notice('Card updated.');
            this.close();
        } else {
            const ok = await appendCardToFile(this.app, cardJson, this.targetFile);
            if (ok) this.close();
        }
    }

    onClose() { this.contentEl.empty(); }
}
