import { App, setIcon, TFile } from 'obsidian';
import * as L from 'leaflet';
import worldGeoJSON from '../data/world-110m.json';
import { BaseEngine } from './base-engine';
import { renderMathInContainer } from '../utils/render-math';
import { addFullscreenButton } from '../utils/fullscreen';

export class MapEngine {
    static async renderInModal(
        app: App,
        filePath: string,
        container: HTMLElement,
        cardData: any,
        cloze: any,
        onComplete: (isCorrect: boolean, userAnswer: string) => void,
        dict: Record<string, string> = {}
    ): Promise<void> {
        container.empty();
        container.addClass('gi-card-col');

        // ── Input bar (at top so keyboard doesn't cover it on mobile) ──────
        const inputWrap = container.createDiv({ cls: 'gi-map-input-wrap' });
        inputWrap.createEl('span', { text: cloze.front || 'Name this location', cls: 'gi-map-input-label' });
        const inputEl = inputWrap.createEl('input', {
            type: 'text',
            placeholder: 'Type answer…',
            cls: 'gi-map-answer-input',
            attr: { autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' },
        });
        const submitBtn = inputWrap.createEl('button', { cls: 'gi-map-submit-btn mod-cta' });
        setIcon(submitBtn, 'arrow-right');

        // Map container fills remaining space below the input
        const mapDiv = container.createDiv({ cls: 'gi-map-container' });

        // Load GeoJSON for this cloze's era
        const geoData = await MapEngine.loadGeoJSON(app, cloze.era);

        // Init Leaflet
        const map = L.map(mapDiv, {
            center: [20, 10],
            zoom: 2,
            worldCopyJump: true,
            attributionControl: false,
            zoomControl: true,
        });

        // Store cleanup on container so session-modal can call it
        (container as any)._leafletCleanup = () => { map.remove(); };

        const isHistorical = cloze.era && cloze.era !== 'present';

        const geoJsonLayer = L.geoJSON(geoData as any, {
            style: {
                fillColor: '#94a3b8',
                fillOpacity: 0.15,
                color: '#475569',
                weight: 1,
            }
        }).addTo(map);

        // Highlight the target feature or drop a point marker
        if (cloze.type === 'region' && cloze.featureId) {
            MapEngine.highlightFeature(geoJsonLayer, cloze.featureId, map, isHistorical);
        } else if (cloze.type === 'point' && cloze.lat != null && cloze.lng != null) {
            L.marker([cloze.lat, cloze.lng], {
                icon: L.divIcon({
                    className: 'gi-map-point-marker',
                    html: '?',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                })
            }).addTo(map);
            map.setView([cloze.lat, cloze.lng], 4);
        }

        addFullscreenButton(container, () => map.invalidateSize());
        requestAnimationFrame(() => map.invalidateSize());

        const handleSubmit = (rawAnswer: string) => {
            inputWrap.remove();
            const userAnswer = rawAnswer.trim().toLowerCase();
            const correctAnswers = (cloze.back || []).map((a: string) => a.toLowerCase());
            const isCorrect = correctAnswers.includes(userAnswer);
            if (isCorrect) {
                onComplete(true, rawAnswer.trim());
            } else {
                MapEngine.revealFeature(geoJsonLayer, cloze, map, isHistorical);
                const compareCard = container.createDiv({ cls: 'gi-incorrect-card' });
                const hdr = compareCard.createDiv({ cls: 'gi-incorrect-hdr' });
                const iconEl = hdr.createDiv({ cls: 'gi-incorrect-icon' });
                setIcon(iconEl, 'x-circle');
                hdr.createEl('span', { text: 'Incorrect', cls: 'gi-incorrect-title' });
                BaseEngine.renderIncorrectContent(
                    app, filePath, compareCard, cloze, rawAnswer.trim(),
                    (wasCorrect) => onComplete(wasCorrect, rawAnswer.trim()),
                    [], dict, cardData
                );
            }
        };
        submitBtn.onclick = () => handleSubmit(inputEl.value);
        inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(inputEl.value); });
    }

    /** Easy mode: show country/region name, user clicks the correct feature on the map. */
    static async renderEasyMode(
        app: App,
        filePath: string,
        container: HTMLElement,
        cardData: any,
        cloze: any,
        onComplete: (isCorrect: boolean, userAnswer: string) => void,
        dict: Record<string, string> = {}
    ): Promise<void> {
        container.empty();
        container.addClass('gi-card-col');

        const correctName: string = Array.isArray(cloze.back) ? (cloze.back[0] ?? '') : '';

        // Prompt at top
        const promptWrap = container.createDiv({ cls: 'gi-easy-prompt' });
        promptWrap.createEl('span', { text: 'Click on: ', cls: 'gi-easy-prompt-label' });
        promptWrap.createEl('strong', { text: correctName || cloze.front || cloze.featureId, cls: 'gi-easy-prompt-name' });

        const mapDiv = container.createDiv({ cls: 'gi-map-container' });
        const geoData = await MapEngine.loadGeoJSON(app, cloze.era);
        const isHistorical = cloze.era && cloze.era !== 'present';

        const map = L.map(mapDiv, {
            center: [20, 10], zoom: 2,
            worldCopyJump: true, attributionControl: false, zoomControl: true,
        });
        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(mapDiv);
        (container as any)._leafletCleanup = () => { ro.disconnect(); map.remove(); };

        addFullscreenButton(container, () => map.invalidateSize());

        let answered = false;

        const geoJsonLayer = L.geoJSON(geoData as any, {
            style: () => ({ fillColor: '#94a3b8', fillOpacity: 0.15, color: '#475569', weight: 1 }),
            onEachFeature: (_feature: any, layer: any) => {
                layer.on({
                    mouseover: () => { if (!answered) layer.setStyle({ fillOpacity: 0.35 }); },
                    mouseout:  () => { if (!answered) layer.setStyle({ fillOpacity: 0.15 }); },
                    click: () => {
                        if (answered) return;
                        answered = true;

                        const props = layer.feature?.properties as any;
                        const clickedId: string = isHistorical
                            ? (props?.NAME ?? '')
                            : (props?.ADM0_A3 ?? props?.ISO_A3 ?? props?.NAME ?? '');
                        const isCorrect = clickedId === cloze.featureId;

                        if (isCorrect) {
                            layer.setStyle({ fillColor: '#22c55e', fillOpacity: 0.6, color: '#16a34a', weight: 2 });
                        } else {
                            layer.setStyle({ fillColor: '#ef4444', fillOpacity: 0.5, color: '#dc2626', weight: 2 });
                            MapEngine.highlightFeature(geoJsonLayer, cloze.featureId, map, isHistorical);
                        }
                        geoJsonLayer.eachLayer((ll: any) => ll.off('click').off('mouseover').off('mouseout'));
                        promptWrap.remove();

                        if (isCorrect) {
                            const badge = container.createDiv({ cls: 'gi-easy-badge gi-easy-correct' });
                            const iconEl = badge.createDiv();
                            setIcon(iconEl, 'check-circle');
                            badge.createEl('span', { text: 'Correct!' });
                            setTimeout(() => onComplete(true, correctName), 900);
                        } else {
                            const compareCard = container.createDiv({ cls: 'gi-incorrect-card' });
                            const hdr = compareCard.createDiv({ cls: 'gi-incorrect-hdr' });
                            const iconEl = hdr.createDiv({ cls: 'gi-incorrect-icon' });
                            setIcon(iconEl, 'x-circle');
                            hdr.createEl('span', { text: 'Incorrect', cls: 'gi-incorrect-title' });
                            BaseEngine.renderIncorrectContent(
                                app, filePath, compareCard, cloze, props?.NAME ?? clickedId,
                                (wasCorrect) => onComplete(wasCorrect, props?.NAME ?? clickedId),
                                [], dict, cardData
                            );
                        }
                    },
                });
            },
        }).addTo(map);

        requestAnimationFrame(() => map.invalidateSize());
    }

    /**
     * Inline preview: renders a real Leaflet map showing all cloze regions/points.
     * Returns a flyTo(clozeIndex) function so name chips can pan the map.
     */
    static async renderPreview(
        app: App,
        container: HTMLElement,
        cardData: any
    ): Promise<{ flyTo: (clozeIndex: number) => void }> {
        const mapDiv = container.createDiv({ cls: 'gi-map-container gi-map-preview' });

        const map = L.map(mapDiv, {
            center: [20, 10], zoom: 2,
            worldCopyJump: true, attributionControl: false, zoomControl: true,
        });

        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(mapDiv);
        (container as any)._leafletCleanup = () => { ro.disconnect(); map.remove(); };

        addFullscreenButton(mapDiv, () => map.invalidateSize());

        // Load GeoJSON for 'present' era as base layer (borders only — deck countries get orange fill)
        const geoData = await MapEngine.loadGeoJSON(app, 'present');
        L.geoJSON(geoData as any, {
            style: { fillColor: 'transparent', fillOpacity: 0, color: '#475569', weight: 0.7 },
        }).addTo(map);

        const clozes: any[] = cardData.clozes || [];
        const bounds: L.LatLngBounds[] = [];

        for (const cloze of clozes) {
            const isHistorical = cloze.era && cloze.era !== 'present';
            const eraData = cloze.era ? await MapEngine.loadGeoJSON(app, cloze.era) : geoData;

            if (cloze.type === 'region' && cloze.featureId) {
                const layer = L.geoJSON(eraData as any, {
                    style: { fillColor: '#94a3b8', fillOpacity: 0, color: 'transparent', weight: 0 },
                    filter: (f: any) => {
                        const p = f.properties;
                        return isHistorical
                            ? p?.NAME === cloze.featureId
                            : (p?.ADM0_A3 === cloze.featureId || p?.ISO_A3 === cloze.featureId || p?.NAME === cloze.featureId);
                    },
                }).addTo(map);
                layer.setStyle({ fillColor: '#f97316', fillOpacity: 0.45, color: '#ea580c', weight: 1.5 });
                try { bounds.push(layer.getBounds()); } catch {}
            } else if (cloze.type === 'point' && cloze.lat != null && cloze.lng != null) {
                const marker = L.marker([cloze.lat, cloze.lng], {
                    icon: L.divIcon({ className: 'gi-map-point-marker', html: '●', iconSize: [14, 14], iconAnchor: [7, 7] })
                }).addTo(map);
                bounds.push(L.latLngBounds([[cloze.lat, cloze.lng]]));
                (marker as any)._clozeIndex = clozes.indexOf(cloze);
            }
        }

        if (bounds.length > 0) {
            const combined = bounds.reduce((acc, b) => acc.extend(b));
            map.fitBounds(combined, { padding: [20, 20], maxZoom: 5 });
        }

        requestAnimationFrame(() => map.invalidateSize());

        // Store per-cloze layer references for flyTo
        const clozeMarkers: Array<{ lat: number; lng: number; featureId?: string }> = clozes.map(c => ({
            lat: c.lat, lng: c.lng, featureId: c.featureId,
        }));

        const flyTo = (idx: number) => {
            const c = clozeMarkers[idx];
            if (!c) return;
            if (c.lat != null && c.lng != null) {
                map.flyTo([c.lat, c.lng], 5, { duration: 0.8 });
            } else if (c.featureId) {
                // Re-scan the base geoJSON for the bounding box
                const layer = L.geoJSON(geoData as any, {
                    filter: (f: any) => {
                        const p = f.properties;
                        return p?.ADM0_A3 === c.featureId || p?.ISO_A3 === c.featureId || p?.NAME === c.featureId;
                    },
                });
                try {
                    map.flyToBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 6, duration: 0.8 });
                } catch {}
            }
        };

        return { flyTo };
    }

    static async loadGeoJSON(app: App, era: string): Promise<any> {
        const eraKey = era || 'present';
        if (eraKey === 'present') return worldGeoJSON;

        // Try to load from plugin's historical-maps folder
        try {
            const relPath = `${app.vault.configDir}/plugins/flashcard-plugin/historical-maps/${eraKey}.json`;
            const content = await app.vault.adapter.read(relPath);
            return JSON.parse(content);
        } catch { /* fall through to bundled present map */ }

        return worldGeoJSON;
    }

    private static highlightFeature(
        layer: L.GeoJSON,
        featureId: string,
        map: L.Map,
        isHistorical: boolean
    ) {
        layer.eachLayer((l: any) => {
            const props = l.feature?.properties as any;
            const match = isHistorical
                ? props?.NAME === featureId
                : (props?.ADM0_A3 === featureId || props?.ISO_A3 === featureId || props?.NAME === featureId);

            if (match) {
                l.setStyle({
                    fillColor: '#f97316',
                    fillOpacity: 0.6,
                    color: '#ea580c',
                    weight: 2,
                });
                if (l.getBounds) {
                    map.fitBounds(l.getBounds(), { padding: [40, 40], maxZoom: 6 });
                }
            }
        });
    }

    /** Reveal the correct feature after a wrong answer — green highlight + name label. */
    private static revealFeature(
        layer: L.GeoJSON,
        cloze: any,
        map: L.Map,
        isHistorical: boolean
    ) {
        const featureId = cloze.featureId;
        if (!featureId) return;

        layer.eachLayer((l: any) => {
            const props = l.feature?.properties as any;
            const match = isHistorical
                ? props?.NAME === featureId
                : (props?.ADM0_A3 === featureId || props?.ISO_A3 === featureId || props?.NAME === featureId);

            if (match) {
                l.setStyle({
                    fillColor: '#22c55e',
                    fillOpacity: 0.55,
                    color: '#16a34a',
                    weight: 2,
                });

                // Add country name label at centroid
                const correctName = Array.isArray(cloze.back) ? cloze.back[0] : (props?.NAME ?? featureId);
                if (l.getBounds) {
                    const center = l.getBounds().getCenter();
                    L.marker(center, {
                        icon: L.divIcon({
                            className: 'gi-map-reveal-label',
                            html: `<span>${correctName}</span>`,
                            iconAnchor: [0, 0],
                        }),
                        interactive: false,
                    }).addTo(map);
                    map.fitBounds(l.getBounds(), { padding: [40, 40], maxZoom: 6 });
                }
            }
        });
    }
}
