import { App, Modal, Setting, TFile } from 'obsidian';
import { appendCardToFile } from '../utils/append-card';

const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav', 'm4a', 'webm'];

interface AudioClozeRow {
    audioPath: string;
    back: string;    // comma-separated accepted answers
    notes: string;
}

export class AudioCreatorModal extends Modal {
    private targetFile: TFile | null;
    private title = '';
    private deck = '';
    private clozes: AudioClozeRow[] = [{ audioPath: '', back: '', notes: '' }];
    private clozeListEl: HTMLElement | null = null;
    private audioFiles: TFile[] = [];

    constructor(app: App, targetFile: TFile | null) {
        super(app);
        this.targetFile = targetFile;
        this.audioFiles = app.vault.getFiles().filter(
            f => AUDIO_EXTENSIONS.includes(f.extension.toLowerCase())
        );
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-creator-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('grand-inventory-modal-window');

        contentEl.createEl('h2', { text: 'New Audio Card' });

        if (this.audioFiles.length === 0) {
            contentEl.createEl('p', {
                text: 'No audio files found in vault. Add .mp3, .ogg, .wav, .m4a, or .webm files first.',
                attr: { style: 'color: var(--text-error);' }
            });
        }

        new Setting(contentEl).setName('Title').addText(t => {
            t.setPlaceholder('e.g. Spanish Top 500');
            t.onChange(v => { this.title = v; });
        });

        new Setting(contentEl).setName('Deck').addText(t => {
            t.setPlaceholder('e.g. Spanish Frequency');
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
            this.clozes.push({ audioPath: '', back: '', notes: '' });
            this.renderClozeList();
        };

        const saveBtn = contentEl.createEl('button', { text: 'Save to Note', cls: 'mod-cta' });
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

            new Setting(row).setName('Audio File').addDropdown(d => {
                d.addOption('', '— pick a file —');
                this.audioFiles.forEach(f => d.addOption(f.path, f.path));
                d.setValue(cloze.audioPath);
                d.onChange(v => { cloze.audioPath = v; });
            });

            new Setting(row).setName('Answers').setDesc('Comma-separated accepted answers').addText(t => {
                t.setValue(cloze.back);
                t.setPlaceholder('e.g. hello, hi, hola');
                t.onChange(v => { cloze.back = v; });
            });

            new Setting(row).setName('Notes').setDesc('Optional — shown on incorrect').addText(t => {
                t.setValue(cloze.notes);
                t.onChange(v => { cloze.notes = v; });
            });

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

    private async save() {
        const cardJson: any = {
            id: `audio-${Date.now()}`,
            type: 'audio',
            title: this.title,
            clozes: this.clozes.map((c, i) => {
                const entry: any = {
                    id: `a-${i}`,
                    audioPath: c.audioPath,
                    back: c.back.split(',').map(s => s.trim()).filter(Boolean),
                };
                if (c.notes.trim()) entry.notes = c.notes.trim();
                return entry;
            })
        };
        if (this.deck.trim()) cardJson.deck = this.deck.trim();

        const ok = await appendCardToFile(this.app, cardJson, this.targetFile);
        if (ok) this.close();
    }

    onClose() { this.contentEl.empty(); }
}
