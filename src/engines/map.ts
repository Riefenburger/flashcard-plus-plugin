import { App, Platform, setIcon, TFile } from 'obsidian';
import * as L from 'leaflet';
import worldGeoJSON from '../data/world-110m.json';
import { BaseEngine } from './base-engine';
import { renderMathInContainer } from '../utils/render-math';

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

        // Question header
        container.createEl('h3', {
            text: cloze.front || 'Name this location',
            attr: { style: 'text-align:center; margin-bottom:10px;' }
        });

        // Map container — explicit height, NOT affected by keyboard
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
        (container as any)._leafletCleanup = () => {
            floatingOverlay?.remove();
            map.remove();
        };

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

        requestAnimationFrame(() => map.invalidateSize());

        // ── Input — floating overlay on mobile, inline on desktop ────────────
        let inputEl: HTMLInputElement;
        let floatingOverlay: HTMLElement | null = null;

        if (Platform.isMobile) {
            // Fixed overlay so the keyboard can't push it offscreen or shrink the map
            floatingOverlay = document.body.createDiv({ cls: 'gi-floating-input-overlay' });
            floatingOverlay.createEl('span', {
                text: cloze.front || 'Answer:',
                cls: 'gi-floating-input-prompt'
            });
            inputEl = floatingOverlay.createEl('input', {
                type: 'text',
                placeholder: 'Type answer…',
                cls: 'gi-floating-input'
            });
        } else {
            inputEl = container.createEl('input', {
                type: 'text',
                placeholder: 'Type your answer…',
                cls: 'gi-map-answer-input'
            });
        }

        setTimeout(() => inputEl.focus(), 100);

        const handleSubmit = (rawAnswer: string) => {
            const userAnswer = rawAnswer.trim().toLowerCase();
            const correctAnswers = (cloze.back || []).map((a: string) => a.toLowerCase());
            const isCorrect = correctAnswers.includes(userAnswer);

            // Remove the input (inline or floating)
            if (floatingOverlay) {
                floatingOverlay.remove();
                floatingOverlay = null;
            } else {
                inputEl.remove();
            }

            if (isCorrect) {
                onComplete(true, rawAnswer.trim());
            } else {
                // Reveal the correct country on the map
                MapEngine.revealFeature(geoJsonLayer, cloze, map, isHistorical);

                // Show incorrect screen BELOW the map (map stays visible)
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

        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') handleSubmit(inputEl.value);
        };
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
