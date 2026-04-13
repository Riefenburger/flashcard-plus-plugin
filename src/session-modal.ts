import { App, Modal, Setting, setIcon } from 'obsidian';
import { PluginData, DailyRecord, SessionRecord, SessionPrefs, SRSEngine, isDue, isMastered, todayISO } from './srs';
import { BaseEngine } from 'engines/base-engine';
import { GridEngine } from 'engines/grid';
import { TraditionalEngine } from './engines/traditional';
import { AudioEngine } from './engines/audio';
import { SVGEngine } from './engines/svg';
import { GlobeEngine } from './engines/globe';
import { ConstellationEngine } from './engines/constellation';
import GrandInventoryPlugin from './main';

function deckColor(name: string): string {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
    return `hsl(${h % 360}, 55%, 55%)`;
}

/** Display label for a cloze — answer where possible, question otherwise. */
function clozeLabel(card: any, cloze: any): string {
    if (card.type === 'grid') {
        const ans = Array.isArray(cloze.answers) ? cloze.answers[0] : null;
        return String(ans ?? cloze.id ?? '—');
    }
    if (card.type === 'constellation' || card.type === 'map' || card.type === 'svg') {
        return String(
            cloze.featureName || cloze.featureId
            || (Array.isArray(cloze.back) ? cloze.back[0] : null)
            || cloze.front || cloze.id || '—'
        );
    }
    // Traditional, timeline, code, audio — prefer the answer (back) over the question (front)
    return String(
        (Array.isArray(cloze.back) ? cloze.back[0] : cloze.back)
        || cloze.front
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

    excludedClozeIds: Set<string> = new Set();
    sessionGroups: Map<string, Set<string>> = new Map();
    selectedGroups: Set<string> = new Set();

    activeMode: 'daily' | 'endless' = 'daily';
    private isDailySession = false;
    private dailyNewCardsReviewed = 0;
    private dailyMasteredCount = 0;

    /** Per-deck new card allocations for the current daily session */
    newCardAllocations: Map<string, number> = new Map();
    /** Decks whose allocation is manually locked */
    lockedNewCardDecks: Set<string> = new Set();
    private newCardAllocInit = false;

    /** Endless mode option: re-add wrong cards to queue (no SRS writes) */
    endlessReaddWrong = false;
    /** Endless mode option: click-to-answer maps/constellations; multiple choice for text cards */
    endlessEasyMode = false;
    /** Constellation display: show stick-figure lines */
    conShowLines = true;
    /** Constellation display: show dim boundary borders for all constellations */
    conShowBorders = true;

    reviewQueue: any[] = [];
    currentCardContainer: HTMLElement | null = null;
    private reviewRoot: HTMLElement | null = null;      // persistent wrapper — never removed mid-session
    private reviewHeaderLabel: HTMLElement | null = null;
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
            this.selectedGroups = new Set(prefs.selectedGroups || []);
            if (prefs.conShowLines !== undefined) this.conShowLines = prefs.conShowLines;
            if (prefs.conShowBorders !== undefined) this.conShowBorders = prefs.conShowBorders;
        } else {
            this.selectedDecks = new Set(this.availableDecks);
            this.availableBatches.forEach((batches, deck) => {
                batches.forEach(b => this.selectedBatches.add(`${deck}::${b}`));
            });
        }

        // Auto-populate groups from cloze group fields (non-destructive merge)
        this.allCards.forEach(card => {
            (card.clozes || []).forEach((cloze: any) => {
                if (!cloze.id || !cloze.group) return;
                if (!this.sessionGroups.has(cloze.group)) {
                    this.sessionGroups.set(cloze.group, new Set());
                }
                this.sessionGroups.get(cloze.group)!.add(cloze.id);
            });
        });
    }

    private savePrefs() {
        const prefs: SessionPrefs = {
            selectedDecks: [...this.selectedDecks],
            selectedBatches: [...this.selectedBatches],
            excludedClozeIds: [...this.excludedClozeIds],
            sessionGroups: Object.fromEntries(
                [...this.sessionGroups.entries()].map(([n, ids]) => [n, [...ids]])
            ),
            selectedGroups: [...this.selectedGroups],
            conShowLines: this.conShowLines,
            conShowBorders: this.conShowBorders,
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
        this.reviewRoot = null;
        this.reviewHeaderLabel = null;

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
            if (!clozeToLabel.has(clozeId)) return; // card deleted — skip
            const deck = clozeToDeck.get(clozeId) ?? '';
            const label = clozeToLabel.get(clozeId)!;
            const color = deck ? deckColor(deck) : 'var(--interactive-accent)';
            const dot = plot.createDiv({ attr: { style: `
                position: absolute; left: ${xPos}%; bottom: ${yPos}%;
                width: 8px; height: 8px;
                background: ${color}; border-radius: 50%; opacity: 0.85;
                transform: translate(-50%, 50%); cursor: default;
            `}});
            dot.title = `${label}${deck ? ` · ${deck}` : ''}\n${card.interval}d interval · ease ${card.ease.toFixed(2)}`;
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

        // ── Mode Tabs ─────────────────────────────────────────────────────
        const tabBar = contentEl.createDiv({ cls: 'gi-mode-tabs' });
        const dailyTab = tabBar.createEl('button', { text: 'Daily', cls: 'gi-mode-tab' });
        const endlessTab = tabBar.createEl('button', { text: 'Endless', cls: 'gi-mode-tab' });

        const tabContent = contentEl.createDiv({ cls: 'gi-mode-tab-content' });

        const activateTab = (mode: 'daily' | 'endless') => {
            this.activeMode = mode;
            dailyTab.toggleClass('gi-mode-tab-active', mode === 'daily');
            endlessTab.toggleClass('gi-mode-tab-active', mode === 'endless');
            tabContent.empty();
            if (mode === 'daily') this.renderDailyTab(tabContent);
            else this.renderEndlessTab(tabContent);
        };

        dailyTab.onclick = () => activateTab('daily');
        endlessTab.onclick = () => activateTab('endless');
        activateTab(this.activeMode);
    }

    // ── Daily Tab ────────────────────────────────────────────────────────────

    private renderDailyTab(container: HTMLElement) {
        // Init allocations once per modal open
        if (!this.newCardAllocInit) {
            this.newCardAllocInit = true;
            this.initNewCardAllocations();
        }

        const dailyStats = this.countDailyStats();

        // ── Completion badge ───────────────────────────────────────────────
        if (this.pluginData.lastDailyDate === todayISO()) {
            const badge = container.createDiv({ cls: 'gi-daily-complete-badge' });
            const iconEl = badge.createEl('span', { cls: 'gi-badge-icon' });
            setIcon(iconEl, 'circle-check');
            badge.createEl('span', { text: 'Daily complete' });
        }

        // ── Stats row ──────────────────────────────────────────────────────
        const statsRow = container.createDiv({ cls: 'gi-daily-stats-row' });
        statsRow.createEl('span', { text: `${dailyStats.due} due`, cls: 'gi-daily-stat gi-daily-stat-due' });
        statsRow.createEl('span', { text: '·', cls: 'gi-daily-stat-sep' });
        statsRow.createEl('span', { text: `${dailyStats.newCards} new`, cls: 'gi-daily-stat' });
        if (dailyStats.masteryDecks > 0) {
            statsRow.createEl('span', { text: '·', cls: 'gi-daily-stat-sep' });
            statsRow.createEl('span', {
                text: `${dailyStats.masteryDecks} mastery card${dailyStats.masteryDecks > 1 ? 's' : ''}`,
                cls: 'gi-daily-stat gi-daily-stat-mastered'
            });
        }

        // ── Contribution calendar ──────────────────────────────────────────
        this.renderContributionCalendar(container);

        // ── New cards allocator ────────────────────────────────────────────
        const allocSection = container.createDiv({ cls: 'gi-alloc-section' });

        const allocHdr = allocSection.createDiv({ cls: 'gi-alloc-hdr' });
        allocHdr.createEl('span', { text: 'New cards today', cls: 'gi-alloc-title' });

        const capWrap = allocHdr.createDiv({ cls: 'gi-alloc-cap-wrap' });
        capWrap.createEl('span', { text: 'Cap:', cls: 'gi-alloc-cap-label' });
        const capInput = capWrap.createEl('input', {
            type: 'number',
            cls: 'gi-alloc-cap-input',
            attr: { min: '0', value: String(this.pluginData.newCardsPerDay ?? 15) }
        });
        capInput.onchange = () => {
            const n = parseInt(capInput.value);
            if (!isNaN(n) && n >= 0) {
                this.pluginData.newCardsPerDay = n;
                this.plugin.savePluginData();
                this.redistributeNewCards();
                renderAllocRows();
            }
        };

        const allocRows = allocSection.createDiv({ cls: 'gi-alloc-rows' });

        const renderAllocRows = () => {
            allocRows.empty();
            const entries = [...this.newCardAllocations.entries()];
            if (entries.length === 0) {
                allocRows.createEl('p', {
                    text: 'No new cards available in selected decks.',
                    attr: { style: 'font-size:0.8em; color:var(--text-muted); margin:4px 0;' }
                });
                return;
            }

            for (const [deckName, allocated] of entries) {
                const available = this.getAvailableNewCards(deckName);
                if (available === 0) continue;
                const isLocked = this.lockedNewCardDecks.has(deckName);

                const row = allocRows.createDiv({ cls: 'gi-alloc-row' });
                row.createDiv({ cls: 'gi-deck-row-swatch', attr: { style: `background:${deckColor(deckName)};` } });
                row.createEl('span', { text: deckName, cls: 'gi-alloc-deck-name' });

                const numInput = row.createEl('input', {
                    type: 'number',
                    cls: 'gi-alloc-num',
                    attr: { min: '0', max: String(available), value: String(allocated) }
                });
                numInput.onchange = () => {
                    const n = Math.max(0, Math.min(parseInt(numInput.value) || 0, available));
                    numInput.value = String(n);
                    this.newCardAllocations.set(deckName, n);
                    this.lockedNewCardDecks.add(deckName);
                    this.redistributeNewCards();
                    renderAllocRows();
                };

                const lockBtn = row.createEl('button', {
                    cls: `gi-lock-btn mod-ghost${isLocked ? ' gi-lock-btn-active' : ''}`,
                    attr: { title: isLocked ? 'Unlock (auto-distribute)' : 'Lock at this value' }
                });
                setIcon(lockBtn, isLocked ? 'lock' : 'unlock');
                lockBtn.onclick = () => {
                    if (this.lockedNewCardDecks.has(deckName)) {
                        this.lockedNewCardDecks.delete(deckName);
                    } else {
                        this.lockedNewCardDecks.add(deckName);
                    }
                    this.redistributeNewCards();
                    renderAllocRows();
                };

                row.createEl('span', { text: `(${available} avail)`, cls: 'gi-alloc-avail' });
            }

            const totalNew = [...this.newCardAllocations.values()].reduce((a, b) => a + b, 0);
            const totalRow = allocRows.createDiv({ cls: 'gi-alloc-total' });
            totalRow.createEl('span', { text: `${totalNew} new  ·  ${dailyStats.due} due  ·  ${dailyStats.masteryDecks} mastery` });
        };

        renderAllocRows();

        // ── Daily settings (collapsible) ───────────────────────────────────
        const settingsWrap = container.createDiv({ cls: 'gi-daily-settings-wrap' });
        const settingsHdr = settingsWrap.createDiv({ cls: 'gi-daily-settings-hdr' });
        const toggleIcon = settingsHdr.createEl('span', { cls: 'gi-deck-tree-toggle' });
        setIcon(toggleIcon, 'chevron-right');
        settingsHdr.createEl('span', { text: 'Daily settings', attr: { style: 'font-size:0.85em; color:var(--text-muted);' } });
        const settingsBody = settingsWrap.createDiv({ cls: 'gi-daily-settings-body' });
        settingsBody.style.display = 'none';

        settingsHdr.onclick = () => {
            const open = settingsBody.style.display !== 'none';
            settingsBody.style.display = open ? 'none' : 'block';
            setIcon(toggleIcon, open ? 'chevron-right' : 'chevron-down');
        };

        new Setting(settingsBody)
            .setName('Confidence Mode')
            .setDesc("If ON, correct answers are 'Good'. If OFF, they are 'Hard'.")
            .addToggle(t => t
                .setValue(this.isConfidentToggle)
                .onChange(val => { this.isConfidentToggle = val; })
            );

        // ── Today's queue preview ──────────────────────────────────────────
        const queueWrap = container.createDiv({ cls: 'gi-daily-settings-wrap' });
        const queueHdr = queueWrap.createDiv({ cls: 'gi-daily-settings-hdr' });
        const queueToggleIcon = queueHdr.createEl('span', { cls: 'gi-deck-tree-toggle' });
        setIcon(queueToggleIcon, 'chevron-right');
        queueHdr.createEl('span', { text: "Today's queue", attr: { style: 'font-size:0.85em; color:var(--text-muted);' } });
        const queueBody = queueWrap.createDiv({ cls: 'gi-daily-queue-body' });
        queueBody.style.display = 'none';
        let queueRendered = false;

        queueHdr.onclick = () => {
            const open = queueBody.style.display !== 'none';
            if (open) {
                queueBody.style.display = 'none';
                setIcon(queueToggleIcon, 'chevron-right');
            } else {
                queueBody.style.display = 'block';
                setIcon(queueToggleIcon, 'chevron-down');
                if (!queueRendered) {
                    queueRendered = true;
                    const items = this.peekDailyQueue();
                    if (items.length === 0) {
                        queueBody.createEl('p', { text: 'No cards in today\'s queue.', attr: { style: 'font-size:0.85em; color:var(--text-muted); margin:4px 0;' } });
                    } else {
                        // Group by deck
                        const byDeck = new Map<string, typeof items>();
                        for (const item of items) {
                            const d = item.card.deck || '(no deck)';
                            if (!byDeck.has(d)) byDeck.set(d, []);
                            byDeck.get(d)!.push(item);
                        }
                        for (const [deck, deckItems] of byDeck) {
                            const grp = queueBody.createDiv({ cls: 'gi-queue-group' });
                            const grpHdr = grp.createDiv({ cls: 'gi-queue-group-hdr' });
                            grpHdr.createDiv({ cls: 'gi-deck-row-swatch', attr: { style: `background:${deckColor(deck)};` } });
                            grpHdr.createEl('span', { text: `${deck} (${deckItems.length})`, cls: 'gi-queue-group-name' });
                            for (const item of deckItems) {
                                const label = clozeLabel(item.card, item.cloze);
                                const state = this.pluginData.cards[item.cloze.id];
                                const row = grp.createDiv({ cls: 'gi-queue-row' });
                                if (item.isNew) row.createEl('span', { text: 'new', cls: 'gi-queue-badge gi-queue-badge-new' });
                                else if (item.isMastery) row.createEl('span', { text: 'mastery', cls: 'gi-queue-badge gi-queue-badge-mastery' });
                                else {
                                    const daysOverdue = state ? Math.floor((Date.now() - state.lastReviewed) / 86_400_000) - state.interval : 0;
                                    const overStr = daysOverdue > 0 ? `+${daysOverdue}d` : `${state?.interval ?? 0}d`;
                                    row.createEl('span', { text: overStr, cls: 'gi-queue-badge gi-queue-badge-due' });
                                }
                                const labelEl = row.createEl('span', { text: label, cls: 'gi-queue-label' });
                                labelEl.title = `${item.card.title || ''} · ${item.card.filePath || ''}`;
                                row.style.cursor = 'pointer';
                                row.onclick = () => {
                                    const file = this.app.vault.getAbstractFileByPath(item.card.filePath);
                                    if (file) {
                                        this.close();
                                        this.app.workspace.openLinkText(item.card.filePath, '', false);
                                    }
                                };
                            }
                        }
                    }
                }
            }
        };

        // ── Start button ───────────────────────────────────────────────────
        const totalToReview = dailyStats.due + [...this.newCardAllocations.values()].reduce((a, b) => a + b, 0) + dailyStats.masteryDecks;
        const startBtn = container.createEl('button', {
            text: totalToReview === 0 ? 'No cards due today' : 'Start Daily',
            cls: 'mod-cta',
            attr: { style: 'width:100%; margin-top:16px;' }
        });
        if (totalToReview === 0) startBtn.disabled = true;
        startBtn.onclick = () => {
            this.savePrefs();
            this.buildDailyQueue();
            this.renderReviewLoop();
        };
    }

    // ── Endless Tab ──────────────────────────────────────────────────────────

    private renderEndlessTab(container: HTMLElement) {
        // ── Session History bar chart ──────────────────────────────────────
        const history = Array.isArray(this.pluginData.history) ? this.pluginData.history : [];
        if (history.length > 0) {
            container.createEl('h4', { text: 'Review History (last 30 sessions)', attr: { style: 'margin: 0 0 6px;' } });
            const recent = history.slice(-30);
            const maxReviewed = Math.max(...recent.map(r => r.reviewed), 1);
            const bars = container.createDiv({ cls: 'gi-history-bars' });
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

        container.createEl('h4', { text: 'Decks', attr: { style: 'margin: 8px 0;' } });

        const deckHeaderRow = container.createDiv({ cls: 'gi-deck-header-row' });
        const searchInput = deckHeaderRow.createEl('input', {
            type: 'text', placeholder: 'Filter decks…', cls: 'gi-deck-search'
        });
        const selectAllBtn = deckHeaderRow.createEl('button', { text: 'All', cls: 'mod-ghost' });
        const clearBtn = deckHeaderRow.createEl('button', { text: 'None', cls: 'mod-ghost' });

        const deckTree = container.createDiv({ cls: 'gi-deck-tree' });

        // Build per-deck group map from cloze group fields
        const deckGroupsMap = new Map<string, Map<string, Array<{ card: any; cloze: any }>>>();
        this.allCards.forEach(card => {
            if (!card.deck || card.type === 'dictionary') return;
            (card.clozes || []).forEach((cloze: any) => {
                if (!cloze.id || !cloze.group) return;
                if (!deckGroupsMap.has(card.deck)) deckGroupsMap.set(card.deck, new Map());
                const dg = deckGroupsMap.get(card.deck)!;
                if (!dg.has(cloze.group)) dg.set(cloze.group, []);
                dg.get(cloze.group)!.push({ card, cloze });
            });
        });

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
                    const deckGroupData = deckGroupsMap.get(deckName);

                    const deckItem = deckTree.createDiv({ cls: 'gi-deck-tree-item' });
                    const deckHeader = deckItem.createDiv({ cls: 'gi-deck-tree-header' });

                    const expandToggle = deckHeader.createEl('span', { cls: 'gi-deck-tree-toggle' });
                    setIcon(expandToggle, 'chevron-right');
                    const deckCb = deckHeader.createEl('input', { type: 'checkbox' });
                    deckCb.id = `gi-deck-cb-${deckName}`;
                    deckCb.checked = this.selectedDecks.has(deckName);
                    deckHeader.createDiv({ cls: 'gi-deck-row-swatch', attr: { style: `background:${deckColor(deckName)};` } });
                    const deckLabel = deckHeader.createEl('label', { text: deckName });
                    deckLabel.htmlFor = deckCb.id;
                    deckHeader.createEl('span', { text: String(totalCount), cls: 'gi-deck-count' });

                    const subList = deckItem.createDiv({ cls: 'gi-deck-tree-batches' });
                    subList.style.display = 'none';

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
                        } else if (deckGroupData && deckGroupData.size > 0) {
                            // Show groups as collapsible sub-folders
                            for (const [groupName, groupClozes] of deckGroupData) {
                                const groupRow = subList.createDiv({ cls: 'gi-deck-tree-batch' });
                                const groupToggle = groupRow.createEl('span', { cls: 'gi-deck-tree-toggle' });
                                setIcon(groupToggle, 'chevron-right');
                                const groupCb = groupRow.createEl('input', { type: 'checkbox' });
                                groupCb.checked = this.selectedGroups.has(groupName);
                                groupCb.onchange = () => {
                                    if (groupCb.checked) this.selectedGroups.add(groupName);
                                    else this.selectedGroups.delete(groupName);
                                    // Update deck checkbox indeterminate state
                                    const anyGroupSel = deckGroupData && [...deckGroupData.keys()].some(g => this.selectedGroups.has(g));
                                    deckCb.indeterminate = !!anyGroupSel;
                                    this.savePrefs();
                                };
                                const gl = groupRow.createEl('label', { text: groupName });
                                gl.htmlFor = '';
                                groupRow.createEl('span', { text: String(groupClozes.length), cls: 'gi-deck-count' });

                                const groupCardList = subList.createDiv({ cls: 'gi-deck-tree-batches' });
                                groupCardList.style.display = 'none';
                                groupClozes.forEach(({ card, cloze }) => addCardRow(groupCardList, card, cloze));

                                const toggleGroup = () => {
                                    const open = groupCardList.style.display !== 'none';
                                    groupCardList.style.display = open ? 'none' : 'block';
                                    setIcon(groupToggle, open ? 'chevron-right' : 'chevron-down');
                                };
                                groupToggle.onclick = (e) => { e.stopPropagation(); toggleGroup(); };
                                groupRow.onclick = (e) => {
                                    const tag = (e.target as HTMLElement).tagName;
                                    if (tag === 'INPUT' || tag === 'LABEL') return;
                                    toggleGroup();
                                };
                            }
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
                        setIcon(expandToggle, isOpen ? 'chevron-right' : 'chevron-down');
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
                            // Clear group filter so all cards in deck are included
                            if (deckGroupData) {
                                for (const g of deckGroupData.keys()) this.selectedGroups.delete(g);
                            }
                        } else {
                            this.selectedDecks.delete(deckName);
                            batches.forEach(b => this.selectedBatches.delete(`${deckName}::${b}`));
                            if (deckGroupData) {
                                for (const g of deckGroupData.keys()) this.selectedGroups.delete(g);
                            }
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

        // ── Endless options ────────────────────────────────────────────────
        new Setting(container)
            .setName('Re-add wrong cards')
            .setDesc('Wrong answers are put back into the queue until correct. No SRS changes are saved in Endless mode.')
            .addToggle(t => t
                .setValue(this.endlessReaddWrong)
                .onChange(val => { this.endlessReaddWrong = val; })
            );

        new Setting(container)
            .setName('Easy Mode')
            .setDesc('Maps & constellations: click the correct region instead of typing. Text cards: pick from multiple choice options.')
            .addToggle(t => t
                .setValue(this.endlessEasyMode)
                .onChange(val => { this.endlessEasyMode = val; })
            );

        new Setting(container)
            .setName('Constellation lines')
            .setDesc('Show stick-figure lines connecting stars in each constellation.')
            .addToggle(t => t
                .setValue(this.conShowLines)
                .onChange(val => { this.conShowLines = val; this.savePrefs(); })
            );

        new Setting(container)
            .setName('Constellation borders')
            .setDesc('Show dim boundary outlines for all constellations.')
            .addToggle(t => t
                .setValue(this.conShowBorders)
                .onChange(val => { this.conShowBorders = val; this.savePrefs(); })
            );

        new Setting(container)
            .setName('Confidence Mode')
            .setDesc("If ON, correct answers are 'Good'. If OFF, they are 'Hard'.")
            .addToggle(t => t
                .setValue(this.isConfidentToggle)
                .onChange(val => { this.isConfidentToggle = val; })
            );

        const startBtn = container.createEl("button", {
            text: "Start Endless",
            cls: "mod-cta",
            attr: { style: "width: 100%; margin-top: 20px;" }
        });
        startBtn.onclick = () => {
            this.savePrefs();
            this.buildQueue();
            this.renderReviewLoop();
        };
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private renderContributionCalendar(container: HTMLElement) {
        const WEEKS = 26;
        const byDate = new Map<string, DailyRecord>();
        (this.pluginData.dailyHistory ?? []).forEach(r => byDate.set(r.date, r));

        const wrap = container.createDiv({ cls: 'gi-cal-wrap' });

        // ── Day-of-week labels + week columns ──────────────────────────────
        const gridWrap = wrap.createDiv({ cls: 'gi-cal-grid-wrap' });

        const dayLabelCol = gridWrap.createDiv({ cls: 'gi-cal-day-labels' });
        ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].forEach(label => {
            dayLabelCol.createEl('span', { text: label, cls: 'gi-cal-day-label' });
        });

        const grid = gridWrap.createDiv({ cls: 'gi-cal-grid' });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Align to Monday: find the Monday of the current week, go back WEEKS weeks
        const todayDow = (today.getDay() + 6) % 7; // 0=Mon … 6=Sun
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - todayDow - (WEEKS - 1) * 7);

        let prevMonth = -1;

        for (let w = 0; w < WEEKS; w++) {
            const col = grid.createDiv({ cls: 'gi-cal-col' });
            for (let d = 0; d < 7; d++) {
                const cell = col.createDiv({ cls: 'gi-cal-cell' });
                const cellDate = new Date(startDate);
                cellDate.setDate(startDate.getDate() + w * 7 + d);
                if (cellDate > today) {
                    cell.addClass('gi-cal-cell-future');
                    continue;
                }
                const dateStr = cellDate.toISOString().slice(0, 10);
                const rec = byDate.get(dateStr);
                if (rec) {
                    const intensity = Math.min(rec.reviewed, 20) / 20;
                    const hue = rec.masteredGained > 0 ? 45 : 142;
                    const sat = Math.round(55 + intensity * 30);
                    const lum = Math.round(65 - intensity * 25);
                    cell.style.background = `hsl(${hue}, ${sat}%, ${lum}%)`;
                    cell.title = [
                        dateStr,
                        `${rec.reviewed} reviewed · ${rec.correct} correct`,
                        rec.newCardsAdded > 0 ? `${rec.newCardsAdded} new cards` : '',
                        rec.masteredGained > 0 ? `${rec.masteredGained} mastered` : '',
                    ].filter(Boolean).join('\n');
                } else {
                    cell.addClass('gi-cal-cell-empty');
                    cell.title = dateStr;
                }

                if (d === 0) {
                    const m = cellDate.getMonth();
                    if (m !== prevMonth) {
                        // Insert month label inside the column — .gi-cal-col has
                        // position:relative so the absolute label anchors correctly.
                        col.createEl('span', {
                            text: cellDate.toLocaleString('default', { month: 'short' }),
                            cls: 'gi-cal-month-label'
                        });
                        prevMonth = m;
                    }
                }
            }
        }

        // ── Legend ─────────────────────────────────────────────────────────
        const legend = wrap.createDiv({ cls: 'gi-cal-legend' });
        legend.createEl('span', { text: 'Less', cls: 'gi-cal-legend-label' });
        [0, 0.25, 0.5, 0.75, 1].forEach(intensity => {
            const swatch = legend.createDiv({ cls: 'gi-cal-swatch' });
            if (intensity === 0) {
                swatch.addClass('gi-cal-cell-empty');
            } else {
                const sat = Math.round(55 + intensity * 30);
                const lum = Math.round(65 - intensity * 25);
                swatch.style.background = `hsl(142, ${sat}%, ${lum}%)`;
            }
        });
        legend.createEl('span', { text: 'More', cls: 'gi-cal-legend-label' });
        const mastSwatch = legend.createDiv({ cls: 'gi-cal-swatch', attr: { style: 'background:hsl(45,75%,55%); margin-left:8px;' } });
        mastSwatch.title = 'Day with mastery gained';
        legend.createEl('span', { text: 'Mastery', cls: 'gi-cal-legend-label' });
    }

    private getAvailableNewCards(deckName: string): number {
        return this.allCards
            .filter((c: any) => c.deck === deckName && c.type !== 'dictionary')
            .flatMap((c: any) => c.clozes || [])
            .filter((cloze: any) =>
                cloze.id &&
                !this.excludedClozeIds.has(cloze.id) &&
                (!this.pluginData.cards[cloze.id] || (this.pluginData.cards[cloze.id]?.interval ?? 0) === 0) &&
                !isMastered(this.pluginData.cards[cloze.id])
            ).length;
    }

    private initNewCardAllocations() {
        this.newCardAllocations.clear();
        this.lockedNewCardDecks.clear();
        const decksWithNew = [...this.selectedDecks].filter(d => this.getAvailableNewCards(d) > 0);
        decksWithNew.forEach(d => this.newCardAllocations.set(d, 0));
        this.redistributeNewCards();
    }

    private redistributeNewCards() {
        const cap = this.pluginData.newCardsPerDay ?? 15;
        const lockedSum = [...this.lockedNewCardDecks]
            .filter(d => this.newCardAllocations.has(d))
            .reduce((s, d) => s + (this.newCardAllocations.get(d) ?? 0), 0);
        const remaining = Math.max(0, cap - lockedSum);

        const freeDecks = [...this.newCardAllocations.keys()]
            .filter(d => !this.lockedNewCardDecks.has(d));
        if (freeDecks.length === 0) return;

        const base = Math.floor(remaining / freeDecks.length);
        const extra = remaining % freeDecks.length;
        freeDecks.forEach((d, i) => {
            const available = this.getAvailableNewCards(d);
            this.newCardAllocations.set(d, Math.min(base + (i < extra ? 1 : 0), available));
        });
    }

    private countDailyStats(): { due: number; newCards: number; mastered: number; masteryDecks: number } {
        let due = 0, mastered = 0;
        const decksWithMastered = new Set<string>();

        const filtered = this.allCards.filter(c => {
            if (c.type === 'dictionary' || !this.selectedDecks.has(c.deck)) return false;
            if (c.batch) return this.selectedBatches.has(`${c.deck}::${c.batch}`);
            return true;
        });

        filtered.forEach(card => {
            (card.clozes || []).forEach((cloze: any) => {
                if (!cloze.id || this.excludedClozeIds.has(cloze.id)) return;
                const state = this.pluginData.cards[cloze.id];
                if (isMastered(state)) {
                    mastered++;
                    decksWithMastered.add(card.deck);
                    return;
                }
                if (state && state.interval > 0 && isDue(state)) {
                    due++;
                }
            });
        });

        const newCards = [...this.newCardAllocations.values()].reduce((a, b) => a + b, 0);
        return { due, newCards, mastered, masteryDecks: decksWithMastered.size };
    }

    // ── Queue builders ───────────────────────────────────────────────────────

    /** Endless queue: sorted harder-first by ease, no SRS writes during review. */
    buildQueue() {
        this.reviewQueue = [];
        this.sessionReviewed = 0;
        this.sessionCorrect = 0;
        this.sessionStart = Date.now();
        this.isDailySession = false;

        // Build per-deck group filter: for each deck that has selected groups,
        // only allow clozes that belong to one of those groups.
        const clozeToDeck = new Map<string, string>();
        this.allCards.forEach(card => {
            (card.clozes || []).forEach((cloze: any) => {
                if (cloze.id) clozeToDeck.set(cloze.id, card.deck);
            });
        });

        const deckGroupFilter = new Map<string, Set<string>>(); // deck → allowed cloze IDs
        for (const groupName of this.selectedGroups) {
            const ids = this.sessionGroups.get(groupName);
            if (!ids) continue;
            for (const id of ids) {
                const deck = clozeToDeck.get(id);
                if (!deck) continue;
                if (!deckGroupFilter.has(deck)) deckGroupFilter.set(deck, new Set());
                deckGroupFilter.get(deck)!.add(id);
            }
        }

        const filtered = this.allCards.filter(c => {
            if (c.type === 'dictionary' || !this.selectedDecks.has(c.deck)) return false;
            if (c.batch) return this.selectedBatches.has(`${c.deck}::${c.batch}`);
            return true;
        });

        filtered.forEach(card => {
            (card.clozes || []).forEach((cloze: any) => {
                if (!cloze.id) return;
                if (this.excludedClozeIds.has(cloze.id)) return;
                // Per-deck group filter: if this deck has active groups, cloze must be in them
                const deckFilter = deckGroupFilter.get(card.deck);
                if (deckFilter && !deckFilter.has(cloze.id)) return;
                this.reviewQueue.push({ ...card, currentCloze: cloze, id: cloze.id, dict: this.dict });
            });
        });

        // Shuffle fully first so order within each tier is random every session
        this.reviewQueue.sort(() => Math.random() - 0.5);
        // Then sort harder cards (lower ease) to the front — new cards (no data) stay shuffled
        this.reviewQueue.sort((a, b) => {
            const stateA = this.pluginData.cards[a.id];
            const stateB = this.pluginData.cards[b.id];
            // Cards with no SRS data yet keep their shuffled position relative to each other
            if (!stateA && !stateB) return 0;
            if (!stateA) return 1;   // new cards after seen cards
            if (!stateB) return -1;
            return stateA.ease - stateB.ease;
        });
    }

    /** Daily queue: due cards + per-deck new card allocations + one mastery card per deck. */
    buildDailyQueue() {
        this.reviewQueue = [];
        this.sessionReviewed = 0;
        this.sessionCorrect = 0;
        this.sessionStart = Date.now();
        this.isDailySession = true;
        this.dailyNewCardsReviewed = 0;
        this.dailyMasteredCount = 0;

        const today = todayISO();
        if (this.pluginData.newCardsDate !== today) {
            this.pluginData.newCardsSeenToday = 0;
            this.pluginData.newCardsDate = today;
        }

        const filtered = this.allCards.filter(c => {
            if (c.type === 'dictionary' || !this.selectedDecks.has(c.deck)) return false;
            if (c.batch) return this.selectedBatches.has(`${c.deck}::${c.batch}`);
            return true;
        });

        // Track new cards added per deck
        const newCardsAdded = new Map<string, number>();
        this.newCardAllocations.forEach((_, d) => newCardsAdded.set(d, 0));

        // Collect mastered cards per deck for mastery virtual items
        const masteredByDeck = new Map<string, Array<{ card: any; cloze: any }>>();

        filtered.forEach(card => {
            (card.clozes || []).forEach((cloze: any) => {
                if (!cloze.id || this.excludedClozeIds.has(cloze.id)) return;
                const state = this.pluginData.cards[cloze.id];

                if (isMastered(state)) {
                    if (!masteredByDeck.has(card.deck)) masteredByDeck.set(card.deck, []);
                    masteredByDeck.get(card.deck)!.push({ card, cloze });
                    return;
                }

                if (!state || state.interval === 0) {
                    const allocation = this.newCardAllocations.get(card.deck) ?? 0;
                    const added = newCardsAdded.get(card.deck) ?? 0;
                    if (added >= allocation) return;
                    newCardsAdded.set(card.deck, added + 1);
                    this.reviewQueue.push({ ...card, currentCloze: cloze, id: cloze.id, dict: this.dict });
                } else if (isDue(state)) {
                    this.reviewQueue.push({ ...card, currentCloze: cloze, id: cloze.id, dict: this.dict });
                }
            });
        });

        // One mastery virtual card per deck that has mastered cards
        for (const [deckName, masteredCards] of masteredByDeck) {
            if (masteredCards.length === 0) continue;
            const picked = masteredCards[Math.floor(Math.random() * masteredCards.length)]!;
            this.reviewQueue.push({
                ...picked.card,
                currentCloze: picked.cloze,
                id: picked.cloze.id,
                dict: this.dict,
                _isMasteryReview: true,
                _masteryDeck: deckName,
            });
        }

        this.reviewQueue.sort(() => Math.random() - 0.5);
    }

    /** Same logic as buildDailyQueue but returns items without mutating state. */
    private peekDailyQueue(): Array<{ card: any; cloze: any; isNew: boolean; isMastery: boolean }> {
        const today = todayISO();
        const seenToday = this.pluginData.newCardsDate === today
            ? (this.pluginData.newCardsSeenToday ?? 0) : 0;

        const filtered = this.allCards.filter(c => {
            if (c.type === 'dictionary' || !this.selectedDecks.has(c.deck)) return false;
            if (c.batch) return this.selectedBatches.has(`${c.deck}::${c.batch}`);
            return true;
        });

        const newCardsAdded = new Map<string, number>();
        this.newCardAllocations.forEach((_, d) => newCardsAdded.set(d, 0));
        const masteredByDeck = new Map<string, Array<{ card: any; cloze: any }>>();
        const result: Array<{ card: any; cloze: any; isNew: boolean; isMastery: boolean }> = [];

        filtered.forEach(card => {
            (card.clozes || []).forEach((cloze: any) => {
                if (!cloze.id || this.excludedClozeIds.has(cloze.id)) return;
                const state = this.pluginData.cards[cloze.id];
                if (isMastered(state)) {
                    if (!masteredByDeck.has(card.deck)) masteredByDeck.set(card.deck, []);
                    masteredByDeck.get(card.deck)!.push({ card, cloze });
                    return;
                }
                if (!state || state.interval === 0) {
                    const allocation = this.newCardAllocations.get(card.deck) ?? 0;
                    const added = newCardsAdded.get(card.deck) ?? 0;
                    if (added >= allocation) return;
                    newCardsAdded.set(card.deck, added + 1);
                    result.push({ card, cloze, isNew: true, isMastery: false });
                } else if (isDue(state)) {
                    result.push({ card, cloze, isNew: false, isMastery: false });
                }
            });
        });

        for (const [, masteredCards] of masteredByDeck) {
            if (masteredCards.length === 0) continue;
            const picked = masteredCards[Math.floor(Math.random() * masteredCards.length)]!;
            result.push({ card: picked.card, cloze: picked.cloze, isNew: false, isMastery: true });
        }

        return result;
    }

    // ── Review loop ──────────────────────────────────────────────────────────

    renderReviewLoop() {
        const { contentEl } = this;

        // Run cleanups on the previous card before emptying anything
        const prevCleanups = ['_leafletCleanup', '_svgCleanup'] as const;
        if (this.currentCardContainer) {
            for (const key of prevCleanups) {
                const fn = (this.currentCardContainer as any)[key];
                if (typeof fn === 'function') fn();
            }
        }

        // First call (or after returning from settings): build the persistent root.
        // Between questions we only empty reviewRoot, never contentEl, so the fullscreen
        // element stays in the DOM and the browser never exits fullscreen.
        if (!this.reviewRoot || !contentEl.contains(this.reviewRoot)) {
            contentEl.empty();
            this.reviewRoot = contentEl.createDiv({ cls: 'gi-review-root' });
        }

        if (this.reviewQueue.length === 0) {
            if (this.isDailySession) {
                this.pluginData.newCardsSeenToday = (this.pluginData.newCardsSeenToday ?? 0) + this.dailyNewCardsReviewed;
                this.pluginData.lastDailyDate = todayISO();

                // Record to daily history (upsert today's entry)
                const dailyRec: DailyRecord = {
                    date: todayISO(),
                    reviewed: this.sessionReviewed,
                    correct: this.sessionCorrect,
                    newCardsAdded: this.dailyNewCardsReviewed,
                    masteredGained: this.dailyMasteredCount,
                };
                if (!Array.isArray(this.pluginData.dailyHistory)) this.pluginData.dailyHistory = [];
                const existIdx = this.pluginData.dailyHistory.findIndex(r => r.date === dailyRec.date);
                if (existIdx >= 0) this.pluginData.dailyHistory[existIdx] = dailyRec;
                else this.pluginData.dailyHistory.push(dailyRec);
                if (this.pluginData.dailyHistory.length > 400) {
                    this.pluginData.dailyHistory.splice(0, this.pluginData.dailyHistory.length - 400);
                }

                this.isDailySession = false;
            }

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

            this.reviewRoot.createEl("h2", { text: "All Done!" });
            const pct = this.sessionReviewed > 0
                ? Math.round((this.sessionCorrect / this.sessionReviewed) * 100)
                : 0;
            this.reviewRoot.createEl("p", {
                text: `Reviewed ${this.sessionReviewed} cards · ${pct}% correct`,
                attr: { style: "color:var(--text-muted); text-align:center;" }
            });
            const backBtn = this.reviewRoot.createEl("button", { text: "← Settings", cls: "mod-ghost" });
            backBtn.style.marginTop = "16px";
            backBtn.onclick = () => { this.reviewRoot = null; this.showSettingsView(); };
            return;
        }

        // Build the persistent header once; after that just update the label text
        const modeLabel = this.isDailySession ? 'Daily' : 'Endless';
        if (!this.reviewHeaderLabel) {
            const header = this.reviewRoot.createDiv({ attr: { style: "display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--background-modifier-border); padding-bottom:10px; margin-bottom:20px;" } });
            this.reviewHeaderLabel = header.createEl("span", {
                text: `${modeLabel} · ${this.reviewQueue.length} left`,
                attr: { style: "color:var(--text-muted); font-size:0.8em;" }
            });
            const toggleContainer = header.createDiv();
            toggleContainer.createEl("span", { text: "Confident: ", attr: { style: "font-size:0.8em; margin-right:4px;" } });
            const cb = toggleContainer.createEl("input", { type: "checkbox" });
            cb.checked = this.isConfidentToggle;
            cb.onchange = () => { this.isConfidentToggle = cb.checked; };
        } else {
            this.reviewHeaderLabel.setText(`${modeLabel} · ${this.reviewQueue.length} left`);
        }

        const item = this.reviewQueue[0]!;
        // Reuse a persistent card slot — replacing only its contents keeps the
        // reviewRoot in the DOM so fullscreen is never interrupted between questions.
        if (!this.currentCardContainer || !this.reviewRoot.contains(this.currentCardContainer)) {
            this.currentCardContainer = this.reviewRoot.createDiv();
        } else {
            this.currentCardContainer.empty();
        }
        const cardContainer = this.currentCardContainer;

        /** Re-insert item into the queue a few positions ahead (not immediately next). */
        const reAddToQueue = (queueItem: any) => {
            const insertAt = Math.min(this.reviewQueue.length, 3 + Math.floor(Math.random() * 3));
            this.reviewQueue.splice(insertAt, 0, queueItem);
        };

        /** Called after incorrect screen is acknowledged, or immediately for map/constellation. */
        const onIncorrectComplete = (wasCorrect: boolean) => {
            if (wasCorrect) this.sessionCorrect++;

            if (!this.isDailySession) {
                // Endless: no SRS writes
                this.reviewQueue.shift();
                if (!wasCorrect && this.endlessReaddWrong) reAddToQueue(item);
                this.renderReviewLoop();
                return;
            }

            // Daily: apply SRS
            const prevState = this.pluginData.cards[item.id];

            if (!wasCorrect) {
                // Reset consecutive daily streak
                const penaltyState = SRSEngine.processReview(prevState, false, this.isConfidentToggle);
                penaltyState.consecutiveDailyCorrect = 0;
                this.pluginData.cards[item.id] = penaltyState;
                this.plugin.savePluginData();
                this.reviewQueue.shift();
                // Re-add without mastery flag (even if it was a mastery review)
                const reAddItem = { ...item, _isMasteryReview: false };
                reAddToQueue(reAddItem);

                // If this was a mastery review and deck still has other mastered cards, add new mastery card
                if (item._isMasteryReview) {
                    this.maybeReAddMasteryCard(item._masteryDeck, item.id);
                }
            } else {
                // Self-corrected on incorrect screen
                const correctState = SRSEngine.processReview(prevState, true, this.isConfidentToggle);
                const prevStreak = prevState?.consecutiveDailyCorrect ?? 0;
                correctState.consecutiveDailyCorrect = prevStreak + 1;
                this.pluginData.cards[item.id] = correctState;
                this.plugin.savePluginData();
                this.reviewQueue.shift();
            }

            this.renderReviewLoop();
        };

        const handleResult = (isCorrect: boolean, userAnswer: string) => {
            this.sessionReviewed++;

            // Track new cards in daily
            if (this.isDailySession && (!this.pluginData.cards[item.id] || (this.pluginData.cards[item.id]?.interval ?? 0) === 0)) {
                this.dailyNewCardsReviewed++;
            }

            if (isCorrect) {
                this.sessionCorrect++;

                if (this.isDailySession) {
                    const prevState = this.pluginData.cards[item.id];
                    const newState = SRSEngine.processReview(prevState, true, this.isConfidentToggle);
                    const prevStreak = prevState?.consecutiveDailyCorrect ?? 0;
                    newState.consecutiveDailyCorrect = prevStreak + 1;
                    // Detect newly mastered cards
                    if (!isMastered(prevState) && isMastered(newState)) {
                        this.dailyMasteredCount++;
                    }
                    this.pluginData.cards[item.id] = newState;
                    this.plugin.savePluginData();
                }
                // Endless: no SRS writes

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

        const easyMode = !this.isDailySession && this.endlessEasyMode;

        if (item.type === "grid") {
            if (easyMode) {
                GridEngine.renderEasyMode(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult, item.dict, this.allCards);
            } else {
                GridEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult, item.dict);
            }
        } else if (item.type === "audio") {
            AudioEngine.renderInModal(this.app, item.filePath, cardContainer, item.currentCloze, handleResult);
        } else if (item.type === "svg") {
            SVGEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult);
        } else if (item.type === "map") {
            if (easyMode) {
                GlobeEngine.renderEasyMode(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult, item.dict);
            } else {
                GlobeEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult, item.dict);
            }
        } else if (item.type === "constellation") {
            const conItem = { ...item, showLines: this.conShowLines, showBorders: this.conShowBorders };
            if (easyMode) {
                ConstellationEngine.renderEasyMode(this.app, item.filePath, cardContainer, conItem, item.currentCloze, handleResult, item.dict);
            } else {
                ConstellationEngine.renderInModal(this.app, item.filePath, cardContainer, conItem, item.currentCloze, handleResult, item.dict);
            }
        } else if (item.type === "code") {
            import('./engines/code').then(m => {
                m.CodeEngine.renderInModal(this.app, item.filePath, cardContainer, item, handleResult);
            });
        } else if (item.type === "timeline") {
            import('./engines/timeline').then(m => {
                m.TimelineEngine.renderInModal(this.app, item.filePath, cardContainer, item, item.currentCloze, handleResult);
            });
        } else {
            if (easyMode) {
                this.renderMultipleChoice(cardContainer, item, handleResult);
            } else {
                TraditionalEngine.renderInModal(this.app, item.filePath, cardContainer, item.currentCloze, handleResult, item.dict);
            }
        }
    }

    /**
     * After a mastery card is answered wrong and removed from the mastery pile,
     * check if the deck still has other mastered cards and if so re-add a mastery virtual card.
     */
    private maybeReAddMasteryCard(deckName: string, failedClozeId: string) {
        const stillMastered: Array<{ card: any; cloze: any }> = [];
        for (const c of this.allCards) {
            if (c.deck !== deckName || c.type === 'dictionary') continue;
            for (const cloze of (c.clozes || [])) {
                if (cloze.id === failedClozeId) continue;
                if (isMastered(this.pluginData.cards[cloze.id])) {
                    stillMastered.push({ card: c, cloze });
                }
            }
        }
        if (stillMastered.length === 0) return;

        const picked = stillMastered[Math.floor(Math.random() * stillMastered.length)]!;
        const insertAt = Math.min(this.reviewQueue.length, 3 + Math.floor(Math.random() * 3));
        this.reviewQueue.splice(insertAt, 0, {
            ...picked.card,
            currentCloze: picked.cloze,
            id: picked.cloze.id,
            dict: this.dict,
            _isMasteryReview: true,
            _masteryDeck: deckName,
        });
    }

    /** Render a multiple-choice card for Easy Mode. */
    private renderMultipleChoice(
        container: HTMLElement,
        item: any,
        handleResult: (isCorrect: boolean, userAnswer: string) => void
    ) {
        const cloze = item.currentCloze;
        const front: string = cloze.front || '';
        const correct: string = Array.isArray(cloze.back) ? (cloze.back[0] ?? '') : (cloze.back ?? '');

        // Gather distractor pool from same deck, then all decks if needed
        const distractors: string[] = [];
        const addFrom = (cards: any[]) => {
            for (const card of cards) {
                for (const c of (card.clozes || []) as any[]) {
                    if (c.id === cloze.id) continue;
                    const ans: string = Array.isArray(c.back) ? (c.back[0] ?? '') : (c.back ?? '');
                    if (ans && ans !== correct && !distractors.includes(ans)) {
                        distractors.push(ans);
                        if (distractors.length >= 9) return;
                    }
                }
                if (distractors.length >= 9) return;
            }
        };
        addFrom(this.allCards.filter((c: any) => c.deck === item.deck));
        if (distractors.length < 3) addFrom(this.allCards);

        const shuffledDistractors = distractors.sort(() => Math.random() - 0.5).slice(0, 3);
        const options = [correct, ...shuffledDistractors].sort(() => Math.random() - 0.5);

        container.empty();
        container.createEl('p', { text: front, cls: 'gi-mc-question' });

        const choicesEl = container.createDiv({ cls: 'gi-mc-choices' });
        for (const opt of options) {
            const btn = choicesEl.createEl('button', { text: opt, cls: 'gi-mc-choice' });
            btn.onclick = () => {
                const isCorrect = opt.toLowerCase() === correct.toLowerCase();
                (choicesEl.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).forEach(b => {
                    b.disabled = true;
                    if (b.textContent?.toLowerCase() === correct.toLowerCase()) b.addClass('gi-mc-correct');
                    else if (b === btn && !isCorrect) b.addClass('gi-mc-wrong');
                });
                setTimeout(() => handleResult(isCorrect, opt), 700);
            };
        }
    }
}
