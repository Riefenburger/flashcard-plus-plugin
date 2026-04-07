import { App, Modal, Notice, TFile, getAllTags, setIcon } from 'obsidian';
import { parseTOMLDict, serializeTOMLDict, DictData } from './utils/toml-dict';

/**
 * DictionaryEditorModal
 *
 * Opens an editor for an `inventory-dict` TOML block.
 *
 * - If `targetFile` is provided, loads/saves that file's dict block.
 * - Otherwise scans all #grand-inventory files for the first existing dict block.
 *
 * Block format written/read:
 *   ```inventory-dict
 *   [H]
 *   name = Hydrogen
 *   number = 1
 *   mass = 1.008
 *   ```
 */
export class DictionaryEditorModal extends Modal {
    private namespaces: Map<string, Map<string, string>> = new Map();
    private sourceFile: TFile | null = null;
    private taggedFiles: TFile[] = [];
    private contentEl2: HTMLElement;

    constructor(app: App, targetFile?: TFile) {
        super(app);
        if (targetFile) this.sourceFile = targetFile;
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

        // If a specific file was passed, load its dict block
        if (this.sourceFile) {
            await this.loadFromFile(this.sourceFile);
            return;
        }

        // Otherwise scan for the first file that has an inventory-dict block
        for (const file of this.taggedFiles) {
            const found = await this.loadFromFile(file);
            if (found) return;
        }
    }

    /** Returns true if an inventory-dict block was found and loaded. */
    private async loadFromFile(file: TFile): Promise<boolean> {
        const content = await this.app.vault.read(file);
        const re = /```inventory-dict\s*([\s\S]*?)\s*```/g;
        let m;
        while ((m = re.exec(content)) !== null) {
            try {
                const data = parseTOMLDict(m[1] ?? '');
                this.sourceFile = file;
                this.namespaces = new Map();
                for (const [ns, fields] of Object.entries(data)) {
                    const fieldMap = new Map<string, string>(Object.entries(fields));
                    this.namespaces.set(ns, fieldMap);
                }
                return true;
            } catch { /* ignore */ }
        }
        return false;
    }

    // ── Render ────────────────────────────────────────────────────────────────

    private render() {
        const el = this.contentEl2;
        // Clear everything below the header (keep h2 + p)
        Array.from(el.children).slice(2).forEach(c => c.remove());

        // File picker — shown only when no existing dict found
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

        // Add namespace + Save — fixed at top
        const topBar = el.createDiv({ attr: { style: 'display:flex; gap:8px; margin-bottom:12px; align-items:center; padding-bottom:12px; border-bottom:1px solid var(--background-modifier-border);' } });
        const nsInput = topBar.createEl('input', { type: 'text', placeholder: 'New namespace (e.g. Na, Fe, vocab)' });
        nsInput.style.flex = '1';
        const addNsBtn = topBar.createEl('button', { text: '+ Add', cls: 'mod-cta' });
        const saveBtn = topBar.createEl('button', { text: 'Save', cls: 'mod-cta' });
        saveBtn.onclick = () => this.save();

        if (this.sourceFile) {
            topBar.createEl('small', {
                text: this.sourceFile.basename,
                attr: { style: 'color:var(--text-faint); font-size:0.78em; white-space:nowrap;' }
            });
        }

        addNsBtn.onclick = () => {
            const name = nsInput.value.trim().replace(/\s+/g, '_');
            if (!name) return;
            if (this.namespaces.has(name)) {
                new Notice(`Namespace "${name}" already exists.`);
                return;
            }
            // Prepend by rebuilding map with new entry first
            const updated = new Map([[name, new Map<string, string>()]]);
            this.namespaces.forEach((v, k) => updated.set(k, v));
            this.namespaces = updated;
            nsInput.value = '';
            this.render();
        };
        nsInput.onkeydown = (e) => { if (e.key === 'Enter') addNsBtn.click(); };

        // Namespace list — newest first (map order is insertion order, already reversed by prepend)
        const nsContainer = el.createDiv({ cls: 'gi-dict-ns-list' });
        this.namespaces.forEach((fields, ns) => {
            this.renderNamespace(nsContainer, ns, fields);
        });
    }

    private renderNamespace(container: HTMLElement, ns: string, fields: Map<string, string>) {
        const block = container.createDiv({ cls: 'gi-dict-ns-block' });

        const hdr = block.createDiv({ cls: 'gi-dict-ns-hdr' });
        const nameEl = hdr.createEl('strong', { text: ns, cls: 'gi-dict-ns-name' });
        hdr.createEl('span', {
            text: `  — reference as {{${ns}.key}}`,
            attr: { style: 'font-size:0.78em; color:var(--text-faint); font-weight:400;' }
        });

        nameEl.contentEditable = 'true';
        nameEl.title = 'Click to rename namespace';
        nameEl.onblur = () => {
            const newName = nameEl.textContent?.trim().replace(/\s+/g, '_') || ns;
            if (newName !== ns && !this.namespaces.has(newName)) {
                this.namespaces.set(newName, fields);
                this.namespaces.delete(ns);
                this.render();
            } else {
                nameEl.textContent = ns;
            }
        };

        const delNsBtn = hdr.createEl('button', { cls: 'mod-ghost gi-dict-del-btn' });
        setIcon(delNsBtn, 'trash-2');
        delNsBtn.title = `Delete namespace "${ns}"`;
        delNsBtn.onclick = () => {
            this.namespaces.delete(ns);
            this.render();
        };

        const rowsEl = block.createDiv({ cls: 'gi-dict-rows' });
        fields.forEach((val, key) => {
            this.renderKVRow(rowsEl, ns, fields, key, val);
        });

        const addRow = block.createDiv({ cls: 'gi-dict-add-row' });
        const keyIn = addRow.createEl('input', { type: 'text', placeholder: 'key', cls: 'gi-dict-key-input' });
        addRow.createEl('span', { text: '=', attr: { style: 'color:var(--text-muted);' } });
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
        row.createEl('span', { text: '=', attr: { style: 'color:var(--text-muted); flex-shrink:0;' } });
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

        // Build DictData from in-memory maps
        const data: DictData = {};
        this.namespaces.forEach((fields, ns) => {
            data[ns] = {};
            fields.forEach((val, key) => { data[ns]![key] = val; });
        });

        const newBlock = '```inventory-dict\n' + serializeTOMLDict(data) + '\n```';

        await this.app.vault.process(this.sourceFile, (content) => {
            const re = /```inventory-dict\s*([\s\S]*?)\s*```/g;
            let replaced = false;
            const result = content.replace(re, () => {
                if (!replaced) { replaced = true; return newBlock; }
                return newBlock; // replace all dict blocks in this file
            });
            if (replaced) return result;
            // No existing block — append to end
            return result + '\n\n' + newBlock + '\n';
        });

        new Notice('Dictionary saved!');
        this.close();
    }
}

/**
 * BrowseDictionaryModal
 *
 * Read-only searchable view of all dictionary terms across the vault.
 */
export class BrowseDictionaryModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('gi-dict-modal');
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass('grand-inventory-modal-window');

        contentEl.createEl('h2', { text: 'Dictionary Terms', attr: { style: 'margin-bottom:4px;' } });

        // Collect all terms
        const allTerms: Array<{ ref: string; val: string; file: string }> = [];
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const tags = cache ? getAllTags(cache) : [];
            const hasTag = tags?.some(t => t.replace('#', '') === 'grand-inventory');
            if (!hasTag) continue;

            const content = await this.app.vault.read(file);
            const re = /```inventory-dict\s*([\s\S]*?)\s*```/g;
            let m;
            while ((m = re.exec(content)) !== null) {
                try {
                    const data = parseTOMLDict(m[1] ?? '');
                    for (const [ns, fields] of Object.entries(data)) {
                        for (const [key, val] of Object.entries(fields)) {
                            allTerms.push({ ref: `{{${ns}.${key}}}`, val, file: file.basename });
                        }
                    }
                } catch { /* ignore */ }
            }
        }

        if (allTerms.length === 0) {
            contentEl.createEl('p', {
                text: 'No dictionary terms found. Create an inventory-dict block first.',
                attr: { style: 'color:var(--text-muted);' }
            });
            return;
        }

        // Search box
        const searchRow = contentEl.createDiv({ attr: { style: 'margin-bottom:10px;' } });
        const searchInput = searchRow.createEl('input', {
            type: 'text',
            placeholder: 'Filter terms…',
            attr: { style: 'width:100%; padding:6px;' }
        });

        // Table
        const tableWrap = contentEl.createDiv({ attr: { style: 'overflow-y:auto; max-height:60vh;' } });
        const table = tableWrap.createEl('table', { attr: { style: 'width:100%; border-collapse:collapse; font-size:0.9em;' } });

        const renderTable = (filter: string) => {
            table.empty();
            const filtered = filter
                ? allTerms.filter(t => t.ref.toLowerCase().includes(filter.toLowerCase()) || t.val.toLowerCase().includes(filter.toLowerCase()))
                : allTerms;
            filtered.forEach(t => {
                const tr = table.createEl('tr');
                tr.createEl('td', { text: t.ref, attr: { style: 'padding:3px 10px 3px 0; color:var(--interactive-accent); font-family:monospace; white-space:nowrap;' } });
                tr.createEl('td', { text: t.val, attr: { style: 'padding:3px 10px 3px 0;' } });
                tr.createEl('td', { text: t.file, attr: { style: 'padding:3px 0; color:var(--text-faint); font-size:0.85em;' } });
            });
            if (filtered.length === 0) {
                const tr = table.createEl('tr');
                tr.createEl('td', { text: 'No matching terms.', attr: { colspan: '3', style: 'padding:8px 0; color:var(--text-muted); text-align:center;' } });
            }
        };

        renderTable('');
        searchInput.oninput = () => renderTable(searchInput.value);
        setTimeout(() => searchInput.focus(), 50);
    }

    onClose() {
        this.contentEl.empty();
    }
}
