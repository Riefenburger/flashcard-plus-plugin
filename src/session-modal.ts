import { App, Modal, Setting } from 'obsidian';
import { PluginData, SessionRecord, SessionPrefs, SRSEngine } from './srs';
import { BaseEngine } from 'engines/base-engine';
import { GridEngine } from 'engines/grid';
import { TraditionalEngine } from './engines/traditional';
import { AudioEngine } from './engines/audio';
import { SVGEngine } from './engines/svg';
import { MapEngine } from './engines/map';
import { ConstellationEngine } from './engines/constellation';
import GrandInventoryPlugin from './main';

function deckColor(name: string): string {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
    return `hsl(${h % 360}, 55%, 55%)`;
}

/** Display label for a cloze in the tree — answer where possible, question otherwise. */
function clozeLabel(card: any, cloze: any): string {
    if (card.type === 'grid') {
        const ans = Array.isArray(cloze.answers) ? cloze.answers[0] : null;
        return String(ans ?? cloze.id ?? '—');
    }
    // For map/constellation the answer (featureName/featureId) is more descriptive than the generic front prompt
    if (card.type === 'constellation' || card.type === 'map' || card.type === 'svg') {
        return String(
            cloze.featureName || cloze.featureId
            || (Array.isArray(cloze.back) ? cloze.back[0] : null)
            || cloze.front || cloze.id || '—'
        );
    }
    return String(
        cloze.front
        || (Array.isArray(cloze.coords) ? `(${cloze.coords.join(',')})` : null)
        || cloze.id || '—'
    );
}

export class SessionModal extends Modal {
    plugin: GrandInventoryPlugin;
    pluginData: PluginData;
    allCards: any[];
    dict: Record<string, string>;

    availableDecks: Set<string> = new Set();
    selectedDecks: Set<string> = new Set();
    availableBatches: Map<string, Set<string>> = new Map();
    selectedBatches: Set<string> = new Set();

    /** Cloze IDs the user has manually unchecked */
    excludedClozeIds: Set<string> = new Set();

    /** Named groups: groupName → Set of cloze IDs (dragged in by user) */
    sessionGroups: Map<string, Set<string>> = new Map();
    /** Which group names are currently active (checked) */
    selectedGroups: Set<string> = new Set();

    reviewQueue: any[] = [];
    currentCardContainer: HTMLElement | null = null;
    isConfidentToggle = true;
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
            if (!card || !card.deck || card.type === 'dictionary') return;
            this.availableDecks.add(card.deck);
            if (card.batch) {
                if (!this.availableBatches.has(card.deck)) this.availableBatches.set(card.deck, new Set());
                this.availableBatches.get(card.deck)!.add(card.batch);
            }
        });

        // Restore saved prefs, defaulting to all-selected
        const prefs = pluginData.sessionPrefs;
        if (prefs) {
            const restoredDecks = (prefs.selectedDecks || []).filter(d => this.availableDecks.has(d));
            this.selectedDecks = restoredDecks.length > 0
                ? new Set(restoredDecks)
                : new Set(this.availableDecks);
            this.selectedBatches = new Set(prefs.selectedBatches || []);
            this.excludedClozeIds = new Set(prefs.excludedClozeIds || []);
            for (const [name, ids] of Object.entries(prefs.sessionGroups || {})) {
                this.sessionGroups.set(name, new Set(ids));
            }
            // Restore selected groups (only ones that still have members)
            this.selectedGroups = new Set(
                [...this.sessionGroups.keys()].filter(g => (this.sessionGroups.get(g)?.size ?? 0) > 0)
            );
        } else {
            this.selectedDecks = new Set(this.availableDecks);
            this.availableBatches.forEach((batches, deck) => {
                batches.forEach(b => this.selectedBatches.add(`${deck}::${b}`));
            });
        }
    }

    private savePrefs() {
        const prefs: SessionPrefs = {
            selectedDecks: [...this.selectedDecks],
            selectedBatches: [...this.selectedBatches],
            excludedClozeIds: [...this.excludedClozeIds],
            sessionGroups: Object.fromEntries(
                [...this.sessionGroups.entries()].map(([n, ids]) => [n, [...ids]])
            ),
        };
        this.pluginData.sessionPrefs = prefs;
        this.plugin.savePluginData();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("inventory-session-container");
        const modalEl = contentEl.closest('.modal');
        if (modalEl) modalEl.addClass("grand-inventory-modal-window");
        this.showSettingsView();
    }

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

        const clozeToDeck = new Map<string, string>();
        const clozeToLabel = new Map<string, string>();
        this.allCards.forEach(card => {
            (card.clozes || []).forEach((c: any) => {
                if (!c.id) return;
                clozeToDeck.set(c.id, card.deck);
                clozeToLabel.set(c.id, clozeLabel(card, c));
            });
        });

        Object.entries(this.pluginData.cards).forEach(([clozeId, card]) => {
            if (card.interval === 0) return;
            const xPos = Math.min((card.interval / 30) * 100, 95);
            const yPos = Math.min(((card.ease - 1.3) / 1.7) * 100, 95);
            const deck = clozeToDeck.get(clozeId) ?? '';
            const label = clozeToLabel.get(clozeId) ?? clozeId;
            const color = deck ? deckColor(deck) : 'var(--interactive-accent)';
            const dot = plot.createDiv({ attr: { style: `
                position: absolute; left: ${xPos}%; bottom: ${yPos}%;
                width: 8px; height: 8px;
                background: ${color}; border-radius: 50%; opacity: 0.85;
                transform: translate(-50%, 50%); cursor: default;
            `}});
            dot.title = `${label}${deck ? ` · ${deck}` : ''}\n${card.interval}d · ease ${card.ease.toFixed(2)}`;
        });

        stats.createEl("small", {
            text: "X: Days until next review | Y: Ease Factor",
            attr: { style: "color: var(--text-muted);" }
        });

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

        // ── Deck + Card Tree ───────────────────────────────────────────────
        contentEl.createEl('h4', { text: 'Decks', attr: { style: 'margin: 16px 0 8px;' } });

        const deckHeaderRow = contentEl.createDiv({ cls: 'gi-deck-header-row' });
        const searchInput = deckHeaderRow.createEl('input', {
            type: 'text', placeholder: 'Filter decks…', cls: 'gi-deck-search'
        });
        const selectAllBtn = deckHeaderRow.createEl('button', { text: 'All', cls: 'mod-ghost' });
        const clearBtn = deckHeaderRow.createEl('button', { text: 'None', cls: 'mod-ghost' });

        const deckTree = contentEl.createDiv({ cls: 'gi-deck-tree' });

        const renderDecks = (filter = '') => {
            deckTree.empty();
            [...this.availableDecks]
                .filter(d => d.toLowerCase().includes(filter.toLowerCase()))
                .sort()
                .forEach(deckName => {
                    const batches = [...(this.availableBatches.get(deckName) ?? [])].sort();
                    const hasBatches = batches.length > 0;
                    const deckCards = this.allCards.filter(c => c.deck === deckName);
                    const totalCount = deckCards.reduce((n: number, c: any) => n + (c.clozes?.length || 0), 0);

                    const deckItem = deckTree.createDiv({ cls: 'gi-deck-tree-item' });
                    const deckHeader = deckItem.createDiv({ cls: 'gi-deck-tree-header' });

                    const expandToggle = deckHeader.createEl('span', { cls: 'gi-deck-tree-toggle', text: '▶' });
                    const deckCb = deckHeader.createEl('input', { type: 'checkbox' });
                    deckCb.id = `gi-deck-cb-${deckName}`;
                    deckCb.checked = this.selectedDecks.has(deckName);
                    deckHeader.createDiv({ cls: 'gi-deck-row-swatch', attr: { style: `background:${deckColor(deckName)};` } });
                    const deckLabel = deckHeader.createEl('label', { text: deckName });
                    deckLabel.htmlFor = deckCb.id;
                    deckHeader.createEl('span', { text: String(totalCount), cls: 'gi-deck-count' });

                    const subList = deckItem.createDiv({ cls: 'gi-deck-tree-batches' });
                    subList.style.display = 'none';

                    /** Add a draggable card row with a checkbox */
                    const addCardRow = (parent: HTMLElement, card: any, cloze: any) => {
                        if (!cloze.id) return;
                        const label = clozeLabel(card, cloze);
                        const row = parent.createDiv({ cls: 'gi-deck-tree-card' });
                        row.setAttribute('draggable', 'true');
                        row.ondragstart = (e) => {
                            e.dataTransfer?.setData('text/plain', cloze.id);
                            row.addClass('gi-card-dragging');
                        };
                        row.ondragend = () => row.removeClass('gi-card-dragging');

                        const cb = row.createEl('input', { type: 'checkbox' });
                        cb.checked = !this.excludedClozeIds.has(cloze.id);
                        cb.onchange = () => {
                            if (cb.checked) this.excludedClozeIds.delete(cloze.id);
                            else this.excludedClozeIds.add(cloze.id);
                            this.savePrefs();
                        };
                        const txt = row.createEl('span', { text: label, cls: 'gi-deck-tree-card-text' });
                        txt.title = label;
                    };

                    const renderSubRows = () => {
                        subList.empty();
                        if (hasBatches) {
                            batches.forEach(batchName => {
                                const key = `${deckName}::${batchName}`;
                                const batchCards = deckCards.filter(c => c.batch === batchName);
                                const count = batchCards.reduce((n: number, c: any) => n + (c.clozes?.length || 0), 0);

                                const batchRow = subList.createDiv({ cls: 'gi-deck-tree-batch' });
                                const batchCb = batchRow.createEl('input', { type: 'checkbox' });
                                batchCb.id = `gi-batch-cb-${key}`;
                                batchCb.checked = this.selectedBatches.has(key);
                                batchCb.onchange = () => {
                                    batchCb.checked
                                        ? this.selectedBatches.add(key)
                                        : this.selectedBatches.delete(key);
                                    const allSel = batches.every(b => this.selectedBatches.has(`${deckName}::${b}`));
                                    const anySel = batches.some(b => this.selectedBatches.has(`${deckName}::${b}`));
                                    deckCb.indeterminate = anySel && !allSel;
                                    deckCb.checked = anySel;
                                    if (!anySel) this.selectedDecks.delete(deckName);
                                    else this.selectedDecks.add(deckName);
                                    this.savePrefs();
                                };
                                const bl = batchRow.createEl('label', { text: batchName });
                                bl.htmlFor = batchCb.id;
                                batchRow.createEl('span', { text: String(count), cls: 'gi-deck-count' });

                                batchCards.forEach(card => {
                                    (card.clozes || []).forEach((cloze: any) => addCardRow(subList, card, cloze));
                                });
                            });
                        } else {
                            deckCards.forEach(card => {
                                (card.clozes || []).forEach((cloze: any) => addCardRow(subList, card, cloze));
                            });
                        }
                    };
                    renderSubRows();

                    const toggleExpand = () => {
                        const isOpen = subList.style.display !== 'none';
                        subList.style.display = isOpen ? 'none' : 'block';
                        expandToggle.textContent = isOpen ? '▶' : '▼';
                    };
                    expandToggle.onclick = (e) => { e.stopPropagation(); toggleExpand(); };
                    deckHeader.onclick = (e) => {
                        const tag = (e.target as HTMLElement).tagName;
                        if (tag === 'INPUT' || tag === 'LABEL') return;
                        toggleExpand();
                    };

                    deckCb.onchange = () => {
                        if (deckCb.checked) {
                            this.selectedDecks.add(deckName);
                            batches.forEach(b => this.selectedBatches.add(`${deckName}::${b}`));
                        } else {
                            this.selectedDecks.delete(deckName);
                            batches.forEach(b => this.selectedBatches.delete(`${deckName}::${b}`));
                        }
                        deckCb.indeterminate = false;
                        renderSubRows();
                        this.savePrefs();
                    };
                });
        };

        renderDecks();
        searchInput.oninput = () => renderDecks(searchInput.value);
        selectAllBtn.onclick = () => {
            this.availableDecks.forEach(d => {
                this.selectedDecks.add(d);
                (this.availableBatches.get(d) ?? new Set()).forEach(b => this.selectedBatches.add(`${d}::${b}`));
            });
            this.savePrefs();
            renderDecks(searchInput.value);
        };
        clearBtn.onclick = () => {
            this.selectedDecks.clear();
            this.availableBatches.forEach((bs, d) => bs.forEach(b => this.selectedBatches.delete(`${d}::${b}`)));
            this.savePrefs();
            renderDecks(searchInput.value);
        };

        // ── Groups (drag cards from deck tree into named groups) ───────────
        const groupsHdr = contentEl.createDiv({ cls: 'gi-deck-header-row', attr: { style: 'margin-top:16px;' } });
        groupsHdr.createEl('h4', { text: 'Groups', attr: { style: 'margin:0; flex:1; font-size:0.9em;' } });
        const newGroupBtn = groupsHdr.createEl('button', { text: '+ New Group', cls: 'mod-ghost' });

        const groupList = contentEl.createDiv({ cls: 'gi-group-list' });

        const renderGroups = () => {
            groupList.empty();
            if (this.sessionGroups.size === 0) {
                groupList.createEl('p', {
                    text: 'Drag cards from the deck tree above into a group to filter your session.',
                    attr: { style: 'font-size:0.8em; color:var(--text-muted); margin:4px 0 8px;' }
                });
            }

            for (const [groupName, clozeIds] of this.sessionGroups) {
                const groupItem = groupList.createDiv({ cls: 'gi-group-item' });

                // Drop zone behaviour
                groupItem.ondragover = (e) => { e.preventDefault(); groupItem.addClass('gi-group-drop-hover'); };
                groupItem.ondragleave = () => groupItem.removeClass('gi-group-drop-hover');
                groupItem.ondrop = (e) => {
                    e.preventDefault();
                    groupItem.removeClass('gi-group-drop-hover');
                    const id = e.dataTransfer?.getData('text/plain');
                    if (id) { clozeIds.add(id); this.savePrefs(); renderGroups(); }
                };

                const groupHdr = groupItem.createDiv({ cls: 'gi-group-header' });
                const expandToggle = groupHdr.createEl('span', { cls: 'gi-deck-tree-toggle', text: '▶' });
                const groupCb = groupHdr.createEl('input', { type: 'checkbox' });
                groupCb.checked = this.selectedGroups.has(groupName);
                groupCb.onchange = () => {
                    if (groupCb.checked) this.selectedGroups.add(groupName);
                    else this.selectedGroups.delete(groupName);
                    this.savePrefs();
                };
                groupHdr.createEl('span', { text: groupName, cls: 'gi-group-name' });
                groupHdr.createEl('span', { text: String(clozeIds.size), cls: 'gi-deck-count' });
                const delBtn = groupHdr.createEl('button', { text: '✕', cls: 'mod-ghost gi-group-delete-btn' });
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.sessionGroups.delete(groupName);
                    this.selectedGroups.delete(groupName);
                    this.savePrefs();
                    renderGroups();
                };

                // Expandable card list inside the group
                const cardList = groupItem.createDiv({ cls: 'gi-deck-tree-batches' });
                cardList.style.display = 'none';

                const renderGroupCards = () => {
                    cardList.empty();
                    for (const clozeId of clozeIds) {
                        let foundLabel = clozeId;
                        for (const card of this.allCards) {
                            const c = (card.clozes || []).find((cl: any) => cl.id === clozeId);
                            if (c) { foundLabel = clozeLabel(card, c); break; }
                        }
                        const row = cardList.createDiv({ cls: 'gi-deck-tree-card' });
                        row.createEl('span', { text: foundLabel, cls: 'gi-deck-tree-card-text' });
                        const removeBtn = row.createEl('button', { text: '✕', cls: 'mod-ghost gi-group-delete-btn' });
                        removeBtn.style.marginLeft = 'auto';
                        removeBtn.onclick = () => { clozeIds.delete(clozeId); this.savePrefs(); renderGroupCards(); };
                    }
                };
                renderGroupCards();

                const toggleGroupExpand = () => {
                    const open = cardList.style.display !== 'none';
                    cardList.style.display = open ? 'none' : 'block';
                    expandToggle.textContent = open ? '▶' : '▼';
                };
                expandToggle.onclick = (e) => { e.stopPropagation(); toggleGroupExpand(); };
                groupHdr.onclick = (e) => {
                    const tag = (e.target as HTMLElement).tagName;
                    if (tag === 'INPUT' || tag === 'BUTTON') return;
                    toggleGroupExpand();
                };
            }
        };
        renderGroups();

        newGroupBtn.onclick = () => {
            const nameWrap = groupList.createDiv({ cls: 'gi-group-new-wrap' });
            const nameInput = nameWrap.createEl('input', {
                type: 'text', placeholder: 'Group name…', cls: 'gi-group-new-input'
            });
            const confirmBtn = nameWrap.createEl('button', { text: '✓', cls: 'mod-cta' });
            const cancelBtn = nameWrap.createEl('button', { text: '✕', cls: 'mod-ghost' });
            nameInput.focus();

            const confirm = () => {
                const name = nameInput.value.trim();
                if (name && !this.sessionGroups.has(name)) {
                    this.sessionGroups.set(name, new Set());
                    this.savePrefs();
                    renderGroups();
                }
                nameWrap.remove();
            };
            confirmBtn.onclick = confirm;
            cancelBtn.onclick = () => nameWrap.remove();
            nameInput.onkeydown = (e) => {
                if (e.key === 'Enter') confirm();
                if (e.key === 'Escape') nameWrap.remove();
            };
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
            this.savePrefs();
            this.buildQueue();
            this.renderReviewLoop();
        };
    }

    buildQueue() {
        this.reviewQueue = [];
        this.sessionReviewed = 0;
        this.sessionCorrect = 0;
        this.sessionStart = Date.now();

        // If any groups are selected, only include clozes that belong to them
        const activeGroups = [...this.selectedGroups].filter(g => this.sessionGroups.has(g));
        const groupClozeIds: Set<string> | null = activeGroups.length > 0
            ? new Set(activeGroups.flatMap(g => [...(this.sessionGroups.get(g) ?? [])]))
            : null;

        const filtered = this.allCards.filter(c => {
            if (c.type === 'dictionary' || !this.selectedDecks.has(c.deck)) return false;
            if (c.batch) return this.selectedBatches.has(`${c.deck}::${c.batch}`);
            return true;
        });

        filtered.forEach(card => {
            card.clozes.forEach((cloze: any) => {
                if (!cloze.id) return;
                if (this.excludedClozeIds.has(cloze.id)) return;
                if (groupClozeIds && !groupClozeIds.has(cloze.id)) return;
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
            const record: SessionRecord = {
                date: this.sessionStart,
                reviewed: this.sessionReviewed,
                correct: this.sessionCorrect,
                decks: [...this.selectedDecks],
            };
            if (!Array.isArray(this.pluginData.history)) this.pluginData.history = [];
            this.pluginData.history.push(record);
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

        const onIncorrectComplete = (wasCorrect: boolean) => {
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
        };

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
                if (item.type === 'map' || item.type === 'constellation') {
                    onIncorrectComplete(false);
                    return;
                }
                if (item.type === 'grid') {
                    GridEngine.renderIncorrectScreen(
                        this.app, item.filePath, contentEl, item, item.currentCloze,
                        userAnswer, onIncorrectComplete, item.dict, this.allCards
                    );
                } else {
                    BaseEngine.renderIncorrectScreen(
                        this.app, item.filePath, contentEl, item.currentCloze,
                        userAnswer, onIncorrectComplete, this.allCards, item.dict, item
                    );
                }
            }
        };

        if (item.type === "grid") {
            GridEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult, item.dict);
        } else if (item.type === "audio") {
            AudioEngine.renderInModal(this.app, item.filePath, cardContainer, item.currentCloze, handleResult);
        } else if (item.type === "svg") {
            SVGEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult);
        } else if (item.type === "map") {
            MapEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult, item.dict);
        } else if (item.type === "constellation") {
            ConstellationEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult, item.dict);
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
