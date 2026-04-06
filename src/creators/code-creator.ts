import { App, Modal, Notice, TFile } from 'obsidian';
import { appendCardToFile } from '../utils/append-card';
import { SupportedLanguage, LANGUAGE_LABELS } from '../utils/code-runner';

const STARTERS: Record<SupportedLanguage, string> = {
    rust:   'fn main() {\n    // your code here\n}',
    python: '# your code here\n',
    c:      '#include <stdio.h>\n\nint main() {\n    // your code here\n    return 0;\n}',
    csharp: '// your code here\n',
    java:   'public class Main {\n    public static void main(String[] args) {\n        // your code here\n    }\n}',
};

export class CodeCreatorModal extends Modal {
    private targetFile: TFile | null;
    private title = '';
    private deck = '';
    private language: SupportedLanguage = 'rust';
    private problem = '';
    private starter = STARTERS['rust'];
    private expectedOutput = '';
    private hints = '';

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

        contentEl.createEl('h2', { text: 'New Code Card' });

        // ── Meta ──
        const metaRow = contentEl.createDiv({ cls: 'gi-painter-meta-row' });

        const titleWrap = metaRow.createDiv({ cls: 'gi-painter-field' });
        titleWrap.createEl('label', { text: 'Title' });
        const titleInput = titleWrap.createEl('input', { type: 'text' });
        titleInput.placeholder = 'e.g. FizzBuzz';
        titleInput.oninput = () => { this.title = titleInput.value; };

        const deckWrap = metaRow.createDiv({ cls: 'gi-painter-field' });
        deckWrap.createEl('label', { text: 'Deck' });
        const deckInput = deckWrap.createEl('input', { type: 'text' });
        deckInput.placeholder = 'e.g. Rust Basics';
        deckInput.oninput = () => { this.deck = deckInput.value; };

        // ── Language ──
        const langWrap = contentEl.createDiv({ cls: 'gi-painter-field', attr: { style: 'margin: 10px 0;' } });
        langWrap.createEl('label', { text: 'Language' });
        const langSelect = langWrap.createEl('select');
        (Object.keys(LANGUAGE_LABELS) as SupportedLanguage[]).forEach(lang => {
            langSelect.createEl('option', { value: lang, text: LANGUAGE_LABELS[lang] });
        });
        langSelect.value = 'rust';
        langSelect.onchange = () => {
            this.language = langSelect.value as SupportedLanguage;
            if (!starterArea.value.trim() || starterArea.value === STARTERS[this.language]) {
                starterArea.value = STARTERS[this.language];
                this.starter = starterArea.value;
            }
        };

        // ── Problem description ──
        contentEl.createEl('label', { text: 'Problem description', attr: { style: 'font-weight:600; margin-top:12px; display:block;' } });
        const problemArea = contentEl.createEl('textarea', { cls: 'gi-code-textarea' });
        problemArea.placeholder = 'Describe the problem. Markdown is supported.';
        problemArea.rows = 5;
        problemArea.oninput = () => { this.problem = problemArea.value; };

        // ── Starter code ──
        contentEl.createEl('label', { text: 'Starter code', attr: { style: 'font-weight:600; margin-top:12px; display:block;' } });
        const starterArea = contentEl.createEl('textarea', { cls: 'gi-code-textarea gi-code-font' });
        starterArea.value = this.starter;
        starterArea.rows = 8;
        starterArea.oninput = () => { this.starter = starterArea.value; };

        // ── Expected output ──
        contentEl.createEl('label', { text: 'Expected output (exact stdout)', attr: { style: 'font-weight:600; margin-top:12px; display:block;' } });
        const outputArea = contentEl.createEl('textarea', { cls: 'gi-code-textarea gi-code-font' });
        outputArea.placeholder = 'e.g. 1\n2\nFizz\n4\nBuzz\n…';
        outputArea.rows = 5;
        outputArea.oninput = () => { this.expectedOutput = outputArea.value; };

        // ── Hints (optional) ──
        contentEl.createEl('label', { text: 'Hints (optional, one per line)', attr: { style: 'font-weight:600; margin-top:12px; display:block;' } });
        const hintsArea = contentEl.createEl('textarea', { cls: 'gi-code-textarea' });
        hintsArea.placeholder = 'Use a for loop\nUse % to check divisibility';
        hintsArea.rows = 3;
        hintsArea.oninput = () => { this.hints = hintsArea.value; };

        // ── Save ──
        contentEl.createEl('div', { attr: { style: 'margin-top:16px;' } });
        const saveBtn = contentEl.createEl('button', { text: 'Save to Note', cls: 'mod-cta' });
        saveBtn.style.width = '100%';
        saveBtn.onclick = () => this.save();
    }

    private async save() {
        if (!this.problem.trim()) { new Notice('Problem description is required.'); return; }
        if (!this.expectedOutput.trim()) { new Notice('Expected output is required.'); return; }

        const cardJson: any = {
            id: `code-${Date.now()}`,
            type: 'code',
            language: this.language,
            title: this.title || `${LANGUAGE_LABELS[this.language]} Problem`,
            problem: this.problem.trim(),
            starter: this.starter,
            expectedOutput: this.expectedOutput,
        };
        if (this.deck.trim()) cardJson.deck = this.deck.trim();
        const hintLines = this.hints.split('\n').map(s => s.trim()).filter(Boolean);
        if (hintLines.length) cardJson.hints = hintLines;

        const ok = await appendCardToFile(this.app, cardJson, this.targetFile);
        if (ok) this.close();
    }

    onClose() { this.contentEl.empty(); }
}
