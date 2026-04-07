import { Notice, Plugin, TFile, setIcon } from 'obsidian';
import { PluginData, DEFAULT_DATA } from 'srs';
import { SessionModal } from 'session-modal';
import { VaultScanner } from 'scanner';
import { GridPainterModal } from 'grid-painter';
import { CardCreatorPickerModal } from 'card-creator';
import { TraditionalCreatorModal } from './creators/traditional-creator';

export default class GrandInventoryPlugin extends Plugin {
    pluginData: PluginData;

    async onload() {
        await this.loadPluginData();

        // Ribbon icon — starts a study session
        this.addRibbonIcon('brain-circuit', 'Start GrandInventory Session', async () => {
            const { cards: allCards, dict } = await VaultScanner.scan(this.app, "#grand-inventory");
            if (allCards.length === 0) {
                new Notice("No cards found! Make sure your files have the #grand-inventory tag.");
                return;
            }
            new SessionModal(this.app, this.pluginData, allCards, this, dict).open();
        });

        // Second ribbon icon — opens the engine picker to create any card type
        this.addRibbonIcon('file-plus', 'Add flashcard', () => {
            new CardCreatorPickerModal(this.app).open();
        });

        // Command palette — opens a blank grid painter to create new cards
        this.addCommand({
            id: 'open-grid-painter',
            name: 'Open Grid Painter (New Card)',
            callback: () => new GridPainterModal(this.app).open()
        });

        // Inline renderer — makes inventory-card blocks look nice while reading
        this.registerMarkdownCodeBlockProcessor("inventory-card", (source, el, ctx) => {
            let cardData: any;
            try {
                cardData = JSON.parse(source);
            } catch {
                el.createEl("p", {
                    text: "⚠ Invalid JSON in inventory-card block.",
                    attr: { style: "color: var(--text-error);" }
                });
                return;
            }

            el.empty();
            el.addClass("gi-inline-preview");

            // Header: title + Edit button for grid cards
            const header = el.createDiv({
                cls: "gi-header",
                attr: { style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;" }
            });
            header.createEl("strong", { text: cardData.title || "Inventory Card" });

            if (cardData.type === "grid") {
                const editBtn = header.createEl("button", { cls: "mod-ghost" });
                setIcon(editBtn, 'pencil');
                editBtn.appendText(" Edit");
                editBtn.style.fontSize = "0.75em";
                editBtn.onclick = () => {
                    new GridPainterModal(this.app, {
                        cardData,
                        filePath: ctx.sourcePath,
                        originalSource: source
                    }).open();
                };
            }

            if (cardData.type === "traditional" || cardData.type === "audio") {
                const editBtn = header.createEl("button", { cls: "mod-ghost" });
                setIcon(editBtn, 'pencil');
                editBtn.appendText(" Edit");
                editBtn.style.fontSize = "0.75em";
                editBtn.onclick = () => {
                    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
                    new TraditionalCreatorModal(this.app, file instanceof TFile ? file : null, {
                        cardData,
                        filePath: ctx.sourcePath,
                        originalSource: source
                    }).open();
                };
            }

            if (cardData.type === "grid") {
                this.renderInlineGrid(el, cardData);
            } else if (cardData.type === "svg") {
                const info = el.createDiv({ attr: { style: "color:var(--text-muted); font-size:0.9em;" } });
                const svgRow = info.createDiv({ attr: { style: 'display:flex; align-items:center; gap:4px;' } });
                setIcon(svgRow, 'pen-tool');
                svgRow.appendText(` SVG: ${cardData.svgPath || "(no file)"}`);
                info.createEl("div", { text: `Pins: ${cardData.clozes?.length || 0}` });
            } else if (cardData.type === "map") {
                const info = el.createDiv({ attr: { style: "color:var(--text-muted); font-size:0.9em;" } });
                const eraNames = Object.keys(cardData.timeline?.eras || {}).join(', ') || 'present';
                const mapRow = info.createDiv({ attr: { style: 'display:flex; align-items:center; gap:4px;' } });
                setIcon(mapRow, 'map');
                mapRow.appendText(` Map · Eras: ${eraNames}`);
                info.createEl("div", { text: `Clozes: ${cardData.clozes?.length || 0}` });
            } else if (cardData.type === "timeline") {
                const info = el.createDiv({ attr: { style: "color:var(--text-muted); font-size:0.9em;" } });
                const tlRow = info.createDiv({ attr: { style: 'display:flex; align-items:center; gap:4px;' } });
                setIcon(tlRow, 'milestone');
                tlRow.appendText(` Timeline · ${cardData.start ?? '?'} → ${cardData.end ?? '?'} ${cardData.unit ?? ''}`);
                info.createEl("div", { text: `Clozes: ${cardData.clozes?.length || 0}` });
            } else if (cardData.type === "code") {
                const info = el.createDiv({ attr: { style: "color:var(--text-muted); font-size:0.9em;" } });
                const codeRow = info.createDiv({ attr: { style: 'display:flex; align-items:center; gap:6px; margin-bottom:4px;' } });
                setIcon(codeRow, 'code-2');
                codeRow.createEl('span', {
                    text: (cardData.language || 'code').toUpperCase(),
                    cls: 'gi-code-lang-badge'
                });
                codeRow.appendText(` ${cardData.title || 'Code Problem'}`);
                if (cardData.problem) {
                    info.createEl('p', {
                        text: cardData.problem.slice(0, 120) + (cardData.problem.length > 120 ? '…' : ''),
                        attr: { style: 'margin:4px 0 0; font-size:0.85em;' }
                    });
                }
            } else {
                // Traditional / audio: list cloze fronts
                const info = el.createDiv({
                    attr: { style: "color: var(--text-muted); font-size: 0.9em;" }
                });
                info.createEl("div", {
                    text: `Cards (${cardData.clozes?.length || 0}):`,
                    attr: { style: "font-weight:bold; margin-bottom:5px;" }
                });
                const ul = info.createEl("ul", { attr: { style: "margin:0; padding-left:20px;" } });
                (cardData.clozes || []).forEach((c: any) => {
                    ul.createEl("li", { text: c.front || c.audioPath || c.id || "(cloze)" });
                });
            }
        });
    }

    // Renders a mini grid preview for inline cards.
    // Correctly handles colSpan/rowSpan by tracking covered positions.
    private renderInlineGrid(el: HTMLElement, cardData: any) {
        const cols: number = cardData.columns || 18;

        const miniGrid = el.createDiv({
            attr: {
                style: `
                    display: grid;
                    grid-template-columns: repeat(${cols}, 1fr);
                    gap: 2px;
                    background: var(--background-secondary);
                    padding: 5px;
                    border-radius: 4px;
                `
            }
        });

        if (!cardData.data || !Array.isArray(cardData.data)) {
            miniGrid.createEl("p", { text: "No grid data found." });
            return;
        }

        // covered[r * cols + c] = true means this position is taken by a span from above/left
        const covered = new Set<number>();

        cardData.data.forEach((row: any, rIdx: number) => {
            if (!Array.isArray(row)) return;

            let cIdx = 0; // current visual column within this row

            row.forEach((cellValue: any) => {
                // Advance past any columns already covered by a prior row's rowSpan
                while (cIdx < cols && covered.has(rIdx * cols + cIdx)) cIdx++;
                if (cIdx >= cols) return;

                const str = String(cellValue);
                const parts = str.split(":");
                const val = parts[0] ?? "";
                const cat = parts[1] || null;
                const colSpan = Math.max(1, parseInt(parts[2] ?? "1") || 1);
                const rowSpan = Math.max(1, parseInt(parts[3] ?? "1") || 1);
                const isEmpty = val === "";
                const categoryStyle = (cat && cardData.categories) ? cardData.categories[cat] : "";

                // Mark all cells this span covers (excluding origin)
                for (let dr = 0; dr < rowSpan; dr++) {
                    for (let dc = 0; dc < colSpan; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        covered.add((rIdx + dr) * cols + (cIdx + dc));
                    }
                }

                miniGrid.createDiv({
                    text: isEmpty ? " " : val,
                    attr: {
                        style: `
                            grid-column: span ${colSpan};
                            grid-row: span ${rowSpan};
                            ${categoryStyle};
                            opacity: ${isEmpty ? "0.2" : "1"};
                            border: 1px solid var(--background-modifier-border);
                            font-size: 0.5em;
                            padding: 2px;
                            text-align: center;
                            min-height: 15px;
                            overflow: hidden;
                            white-space: nowrap;
                        `
                    }
                });

                cIdx += colSpan;
            });
        });
    }

    async loadPluginData() {
        this.pluginData = Object.assign({}, DEFAULT_DATA, await this.loadData());
    }

    async savePluginData() {
        await this.saveData(this.pluginData);
    }
}
