import { App, Modal, Setting } from 'obsidian';
import { PluginData, SessionRecord, SRSEngine } from './srs';
import { BaseEngine } from 'engines/base-engine';
import { GridEngine } from 'engines/grid';
import { TraditionalEngine } from './engines/traditional';
import { AudioEngine } from './engines/audio';
import { SVGEngine } from './engines/svg';
import { MapEngine } from './engines/map';
import GrandInventoryPlugin from './main';

// Deterministic hue from deck name
function deckColor(name: string): string {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
    return `hsl(${h % 360}, 55%, 55%)`;
}

export class SessionModal extends Modal {
    plugin: GrandInventoryPlugin;
    pluginData: PluginData;
    allCards: any[];
    dict: Record<string, string>;
    availableDecks: Set<string> = new Set();
    selectedDecks: Set<string> = new Set();
    reviewQueue: any[] = [];
    currentCardContainer: HTMLElement | null = null;
    private sessionReviewed = 0;
    private sessionCorrect = 0;
    private sessionStart = 0;

    constructor(app: App, pluginData: PluginData, allCards: any[], plugin: GrandInventoryPlugin, dict: Record<string, string> = {}) {
        super(app);
        this.app = app;
        this.pluginData = pluginData;
        this.allCards = allCards || [];
        this.dict = dict;
        this.plugin = plugin;

        this.allCards.forEach(card => {
            if (card && card.deck && card.type !== 'dictionary') this.availableDecks.add(card.deck);
        });
        this.selectedDecks = new Set(this.availableDecks);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("inventory-session-container");
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass("grand-inventory-modal-window");
        this.showSettingsView();
    }

    isConfidentToggle = true;

    showSettingsView() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: "Session Settings" });

        if (this.availableDecks.size === 0) {
            contentEl.createEl("p", { text: "No decks found. Check your file tags." });
            return;
        }

        // ── Memory Matrix ──────────────────────────────────────────────────
        const stats = contentEl.createDiv({ cls: "gi-stats-container" });
        stats.createEl("h4", { text: "Memory Matrix", attr: { style: "margin-bottom: 5px;" } });

        const plot = stats.createDiv({ attr: { style: `
            position: relative; width: 100%; height: 150px;
            background: var(--background-secondary);
            border-left: 2px solid var(--text-muted);
            border-bottom: 2px solid var(--text-muted);
            margin-bottom: 8px;
        `}});

        // Build clozeId → deck + front text lookup
        const clozeToDeck = new Map<string, string>();
        const clozeToFront = new Map<string, string>();
        this.allCards.forEach(card => {
            (card.clozes || []).forEach((c: any) => {
                if (!c.id) return;
                clozeToDeck.set(c.id, card.deck);
                // Use front text, or featureName/featureId for map cards, or coords for grid
                const front = c.front || c.featureName || c.featureId
                    || (Array.isArray(c.coords) ? `(${c.coords.join(',')})` : null)
                    || c.id;
                clozeToFront.set(c.id, String(front));
            });
        });

        Object.entries(this.pluginData.cards).forEach(([clozeId, card]) => {
            if (card.interval === 0) return;
            const xPos = Math.min((card.interval / 30) * 100, 95);
            const yPos = Math.min(((card.ease - 1.3) / 1.7) * 100, 95);
            const deck = clozeToDeck.get(clozeId) ?? '';
            const front = clozeToFront.get(clozeId) ?? clozeId;
            const color = deck ? deckColor(deck) : 'var(--interactive-accent)';

            const dot = plot.createDiv({ attr: { style: `
                position: absolute; left: ${xPos}%; bottom: ${yPos}%;
                width: 8px; height: 8px;
                background: ${color}; border-radius: 50%; opacity: 0.85;
                transform: translate(-50%, 50%);
                cursor: default;
            `}});
            dot.title = `${front}${deck ? ` · ${deck}` : ''}\n${card.interval}d · ease ${card.ease.toFixed(2)}`;
        });

        stats.createEl("small", {
            text: "X: Days until next review | Y: Ease Factor",
            attr: { style: "color: var(--text-muted);" }
        });

        // Deck color legend
        if (this.availableDecks.size > 0) {
            const legend = stats.createDiv({ cls: 'gi-deck-legend' });
            this.availableDecks.forEach(d => {
                const item = legend.createDiv({ cls: 'gi-deck-legend-item' });
                item.createDiv({ cls: 'gi-deck-legend-swatch', attr: { style: `background:${deckColor(d)}` } });
                item.createEl('span', { text: d });
            });
        }

        // ── Session History ────────────────────────────────────────────────
        const history = Array.isArray(this.pluginData.history) ? this.pluginData.history : [];
        if (history.length > 0) {
            stats.createEl('h4', { text: 'Review History (last 30 sessions)', attr: { style: 'margin: 14px 0 6px;' } });
            const recent = history.slice(-30);
            const maxReviewed = Math.max(...recent.map(r => r.reviewed), 1);

            const bars = stats.createDiv({ cls: 'gi-history-bars' });
            recent.forEach(r => {
                const col = bars.createDiv({ cls: 'gi-history-col' });
                const pct = r.reviewed > 0 ? Math.round((r.correct / r.reviewed) * 100) : 0;
                const heightPct = Math.max(4, Math.round((r.reviewed / maxReviewed) * 100));
                const bar = col.createDiv({ cls: 'gi-history-bar' });
                bar.style.height = `${heightPct}%`;
                bar.style.background = `hsl(${pct * 1.2}, 60%, 50%)`;
                bar.title = `${new Date(r.date).toLocaleDateString()} · ${r.reviewed} reviewed · ${pct}% correct`;
            });
        }

        // ── Deck Selector ──────────────────────────────────────────────────
        contentEl.createEl('h4', { text: 'Decks', attr: { style: 'margin: 16px 0 8px;' } });

        const deckHeaderRow = contentEl.createDiv({ cls: 'gi-deck-header-row' });
        const searchInput = deckHeaderRow.createEl('input', {
            type: 'text',
            placeholder: 'Filter decks…',
            cls: 'gi-deck-search'
        });
        const selectAllBtn = deckHeaderRow.createEl('button', { text: 'All', cls: 'mod-ghost' });
        const clearBtn = deckHeaderRow.createEl('button', { text: 'None', cls: 'mod-ghost' });

        const deckList = contentEl.createDiv({ cls: 'gi-deck-list' });

        const renderDecks = (filter = '') => {
            deckList.empty();
            [...this.availableDecks]
                .filter(d => d.toLowerCase().includes(filter.toLowerCase()))
                .forEach(deckName => {
                    const count = this.allCards
                        .filter(c => c.deck === deckName)
                        .reduce((n: number, c: any) => n + (c.clozes?.length || 0), 0);

                    const row = deckList.createDiv({ cls: 'gi-deck-row' });

                    const swatch = row.createDiv({ cls: 'gi-deck-row-swatch' });
                    swatch.style.background = deckColor(deckName);

                    const cb = row.createEl('input', { type: 'checkbox' });
                    cb.id = `gi-deck-cb-${deckName}`;
                    cb.checked = this.selectedDecks.has(deckName);
                    cb.onchange = () => {
                        cb.checked ? this.selectedDecks.add(deckName) : this.selectedDecks.delete(deckName);
                    };

                    const label = row.createEl('label', { text: deckName });
                    label.htmlFor = cb.id;

                    row.createEl('span', { text: String(count), cls: 'gi-deck-count' });
                });
        };

        renderDecks();
        searchInput.oninput = () => renderDecks(searchInput.value);
        selectAllBtn.onclick = () => {
            this.availableDecks.forEach(d => this.selectedDecks.add(d));
            renderDecks(searchInput.value);
        };
        clearBtn.onclick = () => {
            this.selectedDecks.clear();
            renderDecks(searchInput.value);
        };

        // ── Confidence Toggle ──────────────────────────────────────────────
        new Setting(contentEl)
            .setName("Confidence Mode")
            .setDesc("If ON, correct answers are 'Good'. If OFF, they are 'Hard'.")
            .addToggle(t => t
                .setValue(this.isConfidentToggle)
                .onChange(val => { this.isConfidentToggle = val; })
            );

        // ── Start Button ───────────────────────────────────────────────────
        const startBtn = contentEl.createEl("button", {
            text: "Start Session",
            cls: "mod-cta",
            attr: { style: "width: 100%; margin-top: 20px;" }
        });
        startBtn.onclick = () => {
            this.buildQueue();
            this.renderReviewLoop();
        };
    }

    buildQueue() {
        this.reviewQueue = [];
        this.sessionReviewed = 0;
        this.sessionCorrect = 0;
        this.sessionStart = Date.now();
        const filtered = this.allCards.filter(c => c.type !== 'dictionary' && this.selectedDecks.has(c.deck));
        filtered.forEach(card => {
            card.clozes.forEach((cloze: any) => {
                this.reviewQueue.push({ ...card, currentCloze: cloze, id: cloze.id, dict: this.dict });
            });
        });
        this.reviewQueue.sort(() => Math.random() - 0.5);
    }

    renderReviewLoop() {
        const { contentEl } = this;

        const prevCleanups = ['_leafletCleanup', '_svgCleanup'] as const;
        if (this.currentCardContainer) {
            for (const key of prevCleanups) {
                const fn = (this.currentCardContainer as any)[key];
                if (typeof fn === 'function') fn();
            }
        }

        contentEl.empty();

        if (this.reviewQueue.length === 0) {
            // Save session record
            const record: SessionRecord = {
                date: this.sessionStart,
                reviewed: this.sessionReviewed,
                correct: this.sessionCorrect,
                decks: [...this.selectedDecks],
            };
            if (!Array.isArray(this.pluginData.history)) this.pluginData.history = [];
            this.pluginData.history.push(record);
            // Keep only last 90 sessions
            if (this.pluginData.history.length > 90) this.pluginData.history.splice(0, this.pluginData.history.length - 90);
            this.plugin.savePluginData();

            contentEl.createEl("h2", { text: "All Done!" });
            const pct = this.sessionReviewed > 0
                ? Math.round((this.sessionCorrect / this.sessionReviewed) * 100)
                : 0;
            contentEl.createEl("p", {
                text: `Reviewed ${this.sessionReviewed} cards · ${pct}% correct`,
                attr: { style: "color:var(--text-muted); text-align:center;" }
            });
            const backBtn = contentEl.createEl("button", { text: "← Settings", cls: "mod-ghost" });
            backBtn.style.marginTop = "16px";
            backBtn.onclick = () => this.showSettingsView();
            return;
        }

        const header = contentEl.createDiv({ attr: { style: "display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--background-modifier-border); padding-bottom:10px; margin-bottom:20px;" } });
        header.createEl("span", { text: `Cards left: ${this.reviewQueue.length}`, attr: { style: "color:var(--text-muted); font-size:0.8em;" } });

        const toggleContainer = header.createDiv();
        toggleContainer.createEl("span", { text: "Confident: ", attr: { style: "font-size:0.8em; margin-right:4px;" } });
        const cb = toggleContainer.createEl("input", { type: "checkbox" });
        cb.checked = this.isConfidentToggle;
        cb.onchange = () => { this.isConfidentToggle = cb.checked; };

        const item = this.reviewQueue[0]!;
        const cardContainer = contentEl.createDiv();
        this.currentCardContainer = cardContainer;

        const handleResult = (isCorrect: boolean, userAnswer: string) => {
            this.sessionReviewed++;
            if (isCorrect) {
                this.sessionCorrect++;
                const newState = SRSEngine.processReview(
                    this.pluginData.cards[item.id],
                    true,
                    this.isConfidentToggle
                );
                this.pluginData.cards[item.id] = newState;
                this.plugin.savePluginData();
                this.reviewQueue.shift();
                this.renderReviewLoop();
            } else {
                // Delay scoring until the user decides: Continue (wrong) or I knew it (correct)
                BaseEngine.renderIncorrectScreen(this.app, item.filePath, contentEl, item.currentCloze, userAnswer, (wasCorrect) => {
                    if (wasCorrect) this.sessionCorrect++;
                    const newState = SRSEngine.processReview(
                        this.pluginData.cards[item.id],
                        wasCorrect,
                        this.isConfidentToggle
                    );
                    this.pluginData.cards[item.id] = newState;
                    this.plugin.savePluginData();
                    this.reviewQueue.shift();
                    this.renderReviewLoop();
                }, this.allCards);
            }
        };

        if (item.type === "grid") {
            GridEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult, item.dict);
        } else if (item.type === "audio") {
            AudioEngine.renderInModal(this.app, item.filePath, cardContainer, item.currentCloze, handleResult);
        } else if (item.type === "svg") {
            SVGEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult);
        } else if (item.type === "map") {
            MapEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult);
        } else if (item.type === "code") {
            import('./engines/code').then(m => {
                m.CodeEngine.renderInModal(this.app, item.filePath, cardContainer, item, handleResult);
            });
        } else if (item.type === "timeline") {
            import('./engines/timeline').then(m => {
                m.TimelineEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult);
            });
        } else {
            TraditionalEngine.renderInModal(this.app, item.filePath, cardContainer, item.currentCloze, handleResult, item.dict);
        }
    }
}
