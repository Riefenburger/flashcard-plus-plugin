import { App, Modal, Notice, TFile, getAllTags, setIcon } from 'obsidian';

/**
 * DictionaryEditorModal
 *
 * Scans all #grand-inventory files for existing dictionary blocks.
 * If one is found it loads it for editing; otherwise it creates a new one
 * in a file the user chooses from a dropdown.
 *
 * Structure edited:
 * {
 *   "type": "dictionary",
 *   "entries": {
 *     "H":  { "name": "Hydrogen", "number": "1", "mass": "1.008" },
 *     "He": { "name": "Helium",   "number": "2", "mass": "4.003" }
 *   }
 * }
 */
export class DictionaryEditorModal extends Modal {
    // In-memory data: namespace → { key → value }
    private namespaces: Map<string, Map<string, string>> = new Map();
    private sourceFile: TFile | null = null;   // file containing the dict block
    private taggedFiles: TFile[] = [];         // all #grand-inventory files
    private contentEl2: HTMLElement;           // alias to avoid shadowing

    constructor(app: App) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-dict-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('grand-inventory-modal-window');

        contentEl.createEl('h2', { text: 'Flashcard Dictionary', attr: { style: 'margin-bottom: 4px;' } });
        contentEl.createEl('p', {
            text: 'Define reusable values. Reference them in any card as {{Namespace.key}}.',
            attr: { style: 'color:var(--text-muted); font-size:0.85em; margin-bottom:16px;' }
        });

        this.contentEl2 = contentEl;

        await this.loadDictionary();
        this.render();
    }

    onClose() {
        this.contentEl.empty();
    }

    // ── Load ─────────────────────────────────────────────────────────────────

    private async loadDictionary() {
        const files = this.app.vault.getMarkdownFiles();
        this.taggedFiles = [];

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const tags = cache ? getAllTags(cache) : [];
            const hasTag = tags?.some(t => t.replace('#', '') === 'grand-inventory');
            if (hasTag) this.taggedFiles.push(file);
        }

        // Find the first file that contains a dictionary block
        for (const file of this.taggedFiles) {
            const content = await this.app.vault.read(file);
            const match = /```inventory-card\s*([\s\S]*?)\s*```/g.exec(content);
            let m;
            const re = /```inventory-card\s*([\s\S]*?)\s*```/g;
            while ((m = re.exec(content)) !== null) {
                try {
                    const json = JSON.parse(m[1] ?? '');
                    if (json.type === 'dictionary') {
                        this.sourceFile = file;
                        this.namespaces = new Map();
                        for (const [ns, fields] of Object.entries(json.entries || {})) {
                            const fieldMap = new Map<string, string>();
                            if (typeof fields === 'object' && fields !== null) {
                                for (const [k, v] of Object.entries(fields as Record<string, string>)) {
                                    fieldMap.set(k, String(v));
                                }
                            }
                            this.namespaces.set(ns, fieldMap);
                        }
                        return;
                    }
                } catch { /* ignore */ }
            }
            void match;
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    private render() {
        const el = this.contentEl2;
        // Clear everything below the header (keep h2 + p)
        Array.from(el.children).slice(2).forEach(c => c.remove());

        // File picker — where to save (shown if no existing dict found yet)
        if (!this.sourceFile && this.taggedFiles.length > 0) {
            const row = el.createDiv({ attr: { style: 'margin-bottom:12px; display:flex; align-items:center; gap:8px;' } });
            row.createEl('label', { text: 'Save to file:', attr: { style: 'font-size:0.85em; color:var(--text-muted);' } });
            const sel = row.createEl('select', { attr: { style: 'flex:1; padding:4px 6px;' } });
            this.taggedFiles.forEach(f => {
                sel.createEl('option', { text: f.basename, attr: { value: f.path } });
            });
            sel.onchange = () => {
                this.sourceFile = this.app.vault.getAbstractFileByPath(sel.value) as TFile ?? null;
            };
            this.sourceFile = this.taggedFiles[0] ?? null;
        }

        if (this.taggedFiles.length === 0) {
            el.createEl('p', {
                text: '⚠ No files with #grand-inventory tag found. Tag a note first.',
                attr: { style: 'color:var(--text-error);' }
            });
            return;
        }

        // Namespace list
        const nsContainer = el.createDiv({ cls: 'gi-dict-ns-list' });
        this.namespaces.forEach((fields, ns) => {
            this.renderNamespace(nsContainer, ns, fields);
        });

        // Add namespace button
        const addNsRow = el.createDiv({ attr: { style: 'display:flex; gap:8px; margin-top:8px; align-items:center;' } });
        const nsInput = addNsRow.createEl('input', { type: 'text', placeholder: 'New namespace (e.g. Na, Fe, vocab)' });
        nsInput.style.flex = '1';
        const addNsBtn = addNsRow.createEl('button', { text: '+ Add Namespace', cls: 'mod-cta' });
        addNsBtn.onclick = () => {
            const name = nsInput.value.trim().replace(/\s+/g, '_');
            if (!name) return;
            if (this.namespaces.has(name)) {
                new Notice(`Namespace "${name}" already exists.`);
                return;
            }
            this.namespaces.set(name, new Map());
            nsInput.value = '';
            this.render();
        };
        nsInput.onkeydown = (e) => { if (e.key === 'Enter') addNsBtn.click(); };

        // Save button
        const footer = el.createDiv({ attr: { style: 'margin-top:16px; padding-top:12px; border-top:1px solid var(--background-modifier-border);' } });
        if (this.sourceFile) {
            footer.createEl('small', {
                text: `Saving to: ${this.sourceFile.path}`,
                attr: { style: 'display:block; color:var(--text-faint); margin-bottom:8px; font-size:0.78em;' }
            });
        }
        const saveBtn = footer.createEl('button', { text: 'Save Dictionary', cls: 'mod-cta', attr: { style: 'width:100%;' } });
        saveBtn.onclick = () => this.save();
    }

    private renderNamespace(container: HTMLElement, ns: string, fields: Map<string, string>) {
        const block = container.createDiv({ cls: 'gi-dict-ns-block' });

        // Namespace header
        const hdr = block.createDiv({ cls: 'gi-dict-ns-hdr' });
        const nameEl = hdr.createEl('strong', { text: ns, cls: 'gi-dict-ns-name' });
        hdr.createEl('span', {
            text: `  — reference as {{${ns}.key}}`,
            attr: { style: 'font-size:0.78em; color:var(--text-faint); font-weight:400;' }
        });

        // Rename namespace inline
        nameEl.contentEditable = 'true';
        nameEl.title = 'Click to rename namespace';
        nameEl.onblur = () => {
            const newName = nameEl.textContent?.trim().replace(/\s+/g, '_') || ns;
            if (newName !== ns && !this.namespaces.has(newName)) {
                this.namespaces.set(newName, fields);
                this.namespaces.delete(ns);
                this.render();
            } else {
                nameEl.textContent = ns; // revert
            }
        };

        const delNsBtn = hdr.createEl('button', { cls: 'mod-ghost gi-dict-del-btn' });
        setIcon(delNsBtn, 'trash-2');
        delNsBtn.title = `Delete namespace "${ns}"`;
        delNsBtn.onclick = () => {
            this.namespaces.delete(ns);
            this.render();
        };

        // Key-value rows
        const rowsEl = block.createDiv({ cls: 'gi-dict-rows' });
        fields.forEach((val, key) => {
            this.renderKVRow(rowsEl, ns, fields, key, val);
        });

        // Add key row
        const addRow = block.createDiv({ cls: 'gi-dict-add-row' });
        const keyIn = addRow.createEl('input', { type: 'text', placeholder: 'key', cls: 'gi-dict-key-input' });
        addRow.createEl('span', { text: ':', attr: { style: 'color:var(--text-muted);' } });
        const valIn = addRow.createEl('input', { type: 'text', placeholder: 'value', cls: 'gi-dict-val-input' });
        const addBtn = addRow.createEl('button', { cls: 'mod-ghost' });
        setIcon(addBtn, 'plus');
        addBtn.title = 'Add entry';

        const doAdd = () => {
            const k = keyIn.value.trim().replace(/\s+/g, '_');
            const v = valIn.value.trim();
            if (!k) return;
            fields.set(k, v);
            keyIn.value = '';
            valIn.value = '';
            // Re-render just the rows section without full re-render
            rowsEl.empty();
            fields.forEach((fv, fk) => this.renderKVRow(rowsEl, ns, fields, fk, fv));
            setTimeout(() => keyIn.focus(), 20);
        };
        addBtn.onclick = doAdd;
        valIn.onkeydown = (e) => { if (e.key === 'Enter') doAdd(); };
    }

    private renderKVRow(container: HTMLElement, _ns: string, fields: Map<string, string>, key: string, val: string) {
        const row = container.createDiv({ cls: 'gi-dict-kv-row' });
        const keyEl = row.createEl('input', { type: 'text', cls: 'gi-dict-key-input' });
        keyEl.value = key;
        row.createEl('span', { text: ':', attr: { style: 'color:var(--text-muted); flex-shrink:0;' } });
        const valEl = row.createEl('input', { type: 'text', cls: 'gi-dict-val-input' });
        valEl.value = val;

        const save = () => {
            const newKey = keyEl.value.trim().replace(/\s+/g, '_');
            const newVal = valEl.value.trim();
            if (!newKey) return;
            if (newKey !== key) {
                fields.delete(key);
                key = newKey;
            }
            fields.set(key, newVal);
        };
        keyEl.onblur = save;
        valEl.onblur = save;
        valEl.onkeydown = (e) => { if (e.key === 'Enter') valEl.blur(); };

        const delBtn = row.createEl('button', { cls: 'mod-ghost gi-dict-del-btn' });
        setIcon(delBtn, 'x');
        delBtn.onclick = () => {
            fields.delete(key);
            row.remove();
        };
    }

    // ── Save ──────────────────────────────────────────────────────────────────

    private async save() {
        if (!this.sourceFile) {
            new Notice('No target file selected.');
            return;
        }

        // Build entries object
        const entries: Record<string, Record<string, string>> = {};
        this.namespaces.forEach((fields, ns) => {
            entries[ns] = {};
            fields.forEach((val, key) => { entries[ns]![key] = val; });
        });

        const newBlock = '```inventory-card\n' + JSON.stringify({ type: 'dictionary', entries }, null, '\t') + '\n```';

        await this.app.vault.process(this.sourceFile, (data) => {
            // Replace existing dictionary block if present
            const re = /```inventory-card\s*([\s\S]*?)\s*```/g;
            let replaced = false;
            const result = data.replace(re, (match, src) => {
                try {
                    if (JSON.parse(src)?.type === 'dictionary') {
                        replaced = true;
                        return newBlock;
                    }
                } catch { /* ignore */ }
                return match;
            });

            if (replaced) return result;

            // No existing dict block — append to end of file
            return result + '\n\n' + newBlock + '\n';
        });

        new Notice('Dictionary saved!');
        this.close();
    }
}
