import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import * as L from 'leaflet';
import worldGeoJSON from './data/world-110m.json';
import { appendCardToFile } from './utils/append-card';

// ── Types ──────────────────────────────────────────────────────────────────

type ClickMode = 'region' | 'point' | 'none';

interface MapCloze {
    id: string;
    type: 'region' | 'point';
    featureId?: string;    // ADM0_A3 for present map, NAME for historical
    featureName?: string;  // human-readable, not written to JSON
    lat?: number;
    lng?: number;
    era: string;           // year as string e.g. "1914", or "present"
    front: string;
    back: string;          // comma-separated at authoring time
    notes: string;
}

// Ordered list of available years — matches files in historical-maps/
const HISTORICAL_YEARS = [1880, 1914, 1920, 1938, 1945, 1994] as const;
export const ALL_YEARS: Array<number | 'present'> = [...HISTORICAL_YEARS, 'present'];

export class MapPainterModal extends Modal {
    private targetFile: TFile | null;
    private title = '';
    private deck = '';
    private cardId = '';

    private activeYear: number | 'present' = 'present';
    private clickMode: ClickMode = 'none';
    private clozes: MapCloze[] = [];

    private map: L.Map | null = null;
    private geoJsonLayer: L.GeoJSON | null = null;
    private labelMarkers: L.Marker[] = [];
    private pointMarkers: L.Marker[] = [];

    // DOM refs
    private mapDiv: HTMLElement | null = null;
    private clozeListEl: HTMLElement | null = null;
    private toolbarEl: HTMLElement | null = null;
    private yearBtns: HTMLElement[] = [];

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

        contentEl.createEl('h2', { text: 'New Map Card' });

        // ── Meta ──
        const metaRow = contentEl.createDiv({ cls: 'gi-painter-meta-row' });

        const titleWrap = metaRow.createDiv({ cls: 'gi-painter-field' });
        titleWrap.createEl('label', { text: 'Title' });
        const titleInput = titleWrap.createEl('input', { type: 'text' });
        titleInput.placeholder = 'e.g. Nations of the World';
        titleInput.oninput = () => { this.title = titleInput.value; };

        const deckWrap = metaRow.createDiv({ cls: 'gi-painter-field' });
        deckWrap.createEl('label', { text: 'Deck' });
        const deckInput = deckWrap.createEl('input', { type: 'text' });
        deckInput.placeholder = 'e.g. World Geography';
        deckInput.oninput = () => { this.deck = deckInput.value; };

        const idWrap = metaRow.createDiv({ cls: 'gi-painter-field gi-painter-field--sm' });
        idWrap.createEl('label', { text: 'ID' });
        const idInput = idWrap.createEl('input', { type: 'text' });
        idInput.placeholder = 'e.g. world-geo';
        idInput.oninput = () => { this.cardId = idInput.value; };

        // ── Year Button Row ──
        const yearRow = contentEl.createDiv({ cls: 'gi-map-year-row' });
        this.yearBtns = [];

        ALL_YEARS.forEach(y => {
            const label = y === 'present' ? 'Now' : String(y);
            const btn = yearRow.createEl('button', { text: label, cls: 'gi-map-year-btn' });
            if (y === this.activeYear) btn.addClass('is-active');
            btn.onclick = () => {
                this.activeYear = y;
                this.yearBtns.forEach(b => b.removeClass('is-active'));
                btn.addClass('is-active');
                this.reloadGeoJsonLayer();
            };
            this.yearBtns.push(btn);
        });

        // ── Toolbar (click mode) ──
        this.toolbarEl = contentEl.createDiv({ cls: 'gi-palette-tools', attr: { style: 'margin-bottom:8px;' } });
        this.renderToolbar();

        // ── Map ──
        this.mapDiv = contentEl.createDiv({ cls: 'gi-map-container' });

        // ── Cloze list ──
        this.clozeListEl = contentEl.createDiv({ cls: 'gi-cloze-list' });

        // ── Footer ──
        const footer = contentEl.createDiv({ cls: 'gi-painter-footer' });
        const saveBtn = footer.createEl('button', { text: 'Save to Note', cls: 'mod-cta' });
        saveBtn.style.width = '100%';
        saveBtn.onclick = () => this.save();

        // Init map after DOM is attached
        requestAnimationFrame(() => this.initMap());
    }

    onClose() {
        this.map?.remove();
        this.map = null;
        this.contentEl.empty();
    }

    private yearToLabel(y: number | 'present'): string {
        return y === 'present' ? 'Present (2024)' : String(y);
    }

    // ── Map init ───────────────────────────────────────────────────────────

    private initMap() {
        if (!this.mapDiv) return;

        this.map = L.map(this.mapDiv, {
            center: [20, 10],
            zoom: 2,
            worldCopyJump: true,
            attributionControl: false,
            zoomControl: true,
        });

        this.reloadGeoJsonLayer();
        requestAnimationFrame(() => this.map?.invalidateSize());
    }

    private async loadGeoJSONForYear(year: number | 'present'): Promise<any> {
        if (year === 'present') return worldGeoJSON;

        try {
            const relPath = `${this.app.vault.configDir}/plugins/flashcard-plugin/historical-maps/${year}.json`;
            const content = await this.app.vault.adapter.read(relPath);
            return JSON.parse(content);
        } catch {
            new Notice(`Historical map for ${year} not found. Showing present map.`);
            return worldGeoJSON;
        }
    }

    private async reloadGeoJsonLayer() {
        if (!this.map) return;

        if (this.geoJsonLayer) { this.geoJsonLayer.remove(); this.geoJsonLayer = null; }
        this.labelMarkers.forEach(m => m.remove());
        this.labelMarkers = [];

        const geoData = await this.loadGeoJSONForYear(this.activeYear);
        const isHistorical = this.activeYear !== 'present';

        if (!this.map.getPane('labelsPane')) {
            const lp = this.map.createPane('labelsPane');
            lp.style.zIndex = '650';
            lp.style.pointerEvents = 'none';
        }

        this.geoJsonLayer = L.geoJSON(geoData as any, {
            style: {
                fillColor: 'var(--background-secondary)',
                fillOpacity: 0.4,
                color: 'var(--text-muted)',
                weight: 1,
            },
            onEachFeature: (feature, layer) => {
                layer.on('click', (e: L.LeafletMouseEvent) => {
                    if (this.clickMode !== 'region') return;
                    L.DomEvent.stopPropagation(e);
                    const props = feature.properties as any;

                    // For historical maps, NAME is the only reliable identifier
                    const featureId: string = isHistorical
                        ? (props.NAME || '')
                        : (props.ADM0_A3 || props.ISO_A3 || props.NAME || '');
                    const featureName: string = props.NAME || featureId;

                    this.openClozeForm('region', { featureId, featureName, latlng: e.latlng });
                });

                const props = feature.properties as any;
                const name: string = props.NAME || '';
                if (name) {
                    try {
                        const bounds = (layer as any).getBounds ? (layer as any).getBounds() : null;
                        if (bounds) {
                            const center = bounds.getCenter();
                            const marker = L.marker(center, {
                                icon: L.divIcon({ className: 'gi-map-label', html: name }),
                                pane: 'labelsPane',
                                interactive: false,
                            } as any).addTo(this.map!);
                            this.labelMarkers.push(marker);
                        }
                    } catch { /* some features may not have bounds */ }
                }
            }
        }).addTo(this.map);

        this.map.on('click', (e: L.LeafletMouseEvent) => {
            if (this.clickMode !== 'point') return;
            this.openClozeForm('point', { latlng: e.latlng });
        });
    }

    // ── Toolbar ────────────────────────────────────────────────────────────

    private renderToolbar() {
        if (!this.toolbarEl) return;
        this.toolbarEl.empty();

        const regionBtn = this.toolbarEl.createEl('button', {
            text: '+ Region (click country)',
            cls: 'gi-painter-swatch'
        });
        regionBtn.toggleClass('gi-brush-active', this.clickMode === 'region');
        regionBtn.onclick = () => {
            this.clickMode = this.clickMode === 'region' ? 'none' : 'region';
            this.renderToolbar();
        };

        const pointBtn = this.toolbarEl.createEl('button', {
            text: '+ Point (click location)',
            cls: 'gi-painter-swatch'
        });
        pointBtn.toggleClass('gi-brush-active', this.clickMode === 'point');
        pointBtn.onclick = () => {
            this.clickMode = this.clickMode === 'point' ? 'none' : 'point';
            this.renderToolbar();
        };

        this.toolbarEl.createEl('small', {
            text: this.clickMode === 'none'
                ? 'Select a mode above to add clozes'
                : this.clickMode === 'region'
                    ? 'Click a country on the map'
                    : 'Click any point on the map',
            attr: { style: 'color:var(--text-muted); align-self:center; margin-left:8px;' }
        });
    }

    // ── Cloze form ─────────────────────────────────────────────────────────

    private openClozeForm(
        type: 'region' | 'point',
        ctx: { featureId?: string; featureName?: string; latlng: L.LatLng }
    ) {
        const prevMode = this.clickMode;
        this.clickMode = 'none';
        this.renderToolbar();

        if (!this.clozeListEl) return;
        this.clozeListEl.empty();

        const form = this.clozeListEl.createDiv({ cls: 'gi-pin-form' });

        form.createEl('strong', {
            text: type === 'region'
                ? `Region: ${ctx.featureName || ctx.featureId} (${this.yearToLabel(this.activeYear)})`
                : `Point: ${ctx.latlng.lat.toFixed(4)}, ${ctx.latlng.lng.toFixed(4)}`
        });

        const qRow = form.createDiv({ cls: 'gi-pin-form-row' });
        qRow.createEl('label', { text: 'Question' });
        const frontInput = qRow.createEl('input', { type: 'text' });
        frontInput.value = type === 'region'
            ? 'Name this country'
            : 'Name this location';
        frontInput.style.width = '100%';
        setTimeout(() => frontInput.focus(), 50);

        const aRow = form.createDiv({ cls: 'gi-pin-form-row' });
        aRow.createEl('label', { text: 'Answers' });
        const backInput = aRow.createEl('input', { type: 'text' });
        backInput.value = ctx.featureName || '';
        backInput.style.width = '100%';

        const nRow = form.createDiv({ cls: 'gi-pin-form-row' });
        nRow.createEl('label', { text: 'Notes (optional)' });
        const notesInput = nRow.createEl('input', { type: 'text' });
        notesInput.style.width = '100%';

        const btnRow = form.createDiv({ attr: { style: 'display:flex; gap:8px; margin-top:10px;' } });

        btnRow.createEl('button', { text: 'Add Cloze', cls: 'mod-cta' }).onclick = () => {
            const newCloze: MapCloze = {
                id: `mc-${Date.now()}`,
                type,
                era: this.activeYear === 'present' ? 'present' : String(this.activeYear),
                front: frontInput.value.trim(),
                back: backInput.value.trim(),
                notes: notesInput.value.trim(),
            };
            if (type === 'region') {
                newCloze.featureId = ctx.featureId;
                newCloze.featureName = ctx.featureName;
            } else {
                newCloze.lat = ctx.latlng.lat;
                newCloze.lng = ctx.latlng.lng;
                L.marker([ctx.latlng.lat, ctx.latlng.lng], {
                    icon: L.divIcon({ className: 'gi-map-point-marker', html: '?', iconSize: [24, 24] }),
                }).addTo(this.map!);
            }
            this.clozes.push(newCloze);
            this.clickMode = prevMode;
            this.renderToolbar();
            this.renderClozeList();
        };

        btnRow.createEl('button', { text: 'Cancel', cls: 'mod-ghost' }).onclick = () => {
            this.clickMode = prevMode;
            this.renderToolbar();
            this.renderClozeList();
        };
    }

    // ── Cloze list ─────────────────────────────────────────────────────────

    private renderClozeList() {
        if (!this.clozeListEl) return;
        this.clozeListEl.empty();

        if (this.clozes.length === 0) {
            this.clozeListEl.createEl('p', {
                text: 'No clozes yet. Select a mode above and click the map.',
                attr: { style: 'color:var(--text-muted); font-size:0.9em;' }
            });
            return;
        }

        this.clozeListEl.createEl('h4', {
            text: `Clozes (${this.clozes.length})`,
            attr: { style: 'margin: 12px 0 6px;' }
        });

        this.clozes.forEach((c, i) => {
            const row = this.clozeListEl!.createDiv({ cls: 'gi-cloze-list-row' });
            const rowLabel = row.createEl('span', { attr: { style: 'flex:1; display:flex; align-items:center; gap:4px;' } });
            setIcon(rowLabel, c.type === 'region' ? 'globe' : 'map-pin');
            rowLabel.appendText(` [${c.era}] ${c.front}`);
            const delBtn = row.createEl('button', { text: '×', cls: 'mod-ghost' });
            delBtn.onclick = () => {
                this.clozes.splice(i, 1);
                this.renderClozeList();
            };
        });
    }

    // ── Export ─────────────────────────────────────────────────────────────

    private generateJSON(): object {
        const result: any = {
            type: 'map',
            title: this.title,
            clozes: this.clozes.map(c => {
                const entry: any = {
                    id: c.id,
                    type: c.type,
                    era: c.era,
                    front: c.front,
                    back: c.back.split(',').map(s => s.trim()).filter(Boolean),
                };
                if (c.type === 'region' && c.featureId) entry.featureId = c.featureId;
                if (c.type === 'point') { entry.lat = c.lat; entry.lng = c.lng; }
                if (c.notes) entry.notes = c.notes;
                return entry;
            })
        };
        if (this.cardId.trim()) result.id = this.cardId.trim();
        if (this.deck.trim()) result.deck = this.deck.trim();
        return result;
    }

    private async save() {
        const ok = await appendCardToFile(this.app, this.generateJSON(), this.targetFile);
        if (ok) this.close();
    }
}
