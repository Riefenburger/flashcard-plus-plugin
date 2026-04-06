import { App, TFile } from 'obsidian';
import * as L from 'leaflet';
import worldGeoJSON from '../data/world-110m.json';
import { BaseEngine } from './base-engine';

export class MapEngine {
    static async renderInModal(
        app: App,
        filePath: string,
        container: HTMLElement,
        cardData: any,
        cloze: any,
        onComplete: (isCorrect: boolean, userAnswer: string) => void
    ): Promise<void> {
        container.empty();

        // Question header
        container.createEl('h3', {
            text: cloze.front || 'Name this location',
            attr: { style: 'text-align:center; margin-bottom:10px;' }
        });

        // Map container — explicit height before L.map()
        const mapDiv = container.createDiv({ cls: 'gi-map-container' });

        // Answer input (below map)
        const input = container.createEl('input', {
            type: 'text',
            placeholder: 'Type your answer…'
        });
        input.style.width = '100%';
        input.style.padding = '10px';
        input.style.fontSize = '16px';
        input.style.marginTop = '10px';

        // Load GeoJSON for this cloze's era
        const geoData = await MapEngine.loadGeoJSON(app, cloze.era);

        // Init Leaflet — NO tile layer, NO label pane
        const map = L.map(mapDiv, {
            center: [20, 10],
            zoom: 2,
            worldCopyJump: true,
            attributionControl: false,
            zoomControl: true,
        });

        // Store cleanup so session-modal can call it before contentEl.empty()
        (mapDiv as any)._leafletCleanup = () => map.remove();

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
        setTimeout(() => input.focus(), 100);

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const userAnswer = input.value.trim().toLowerCase();
                const correctAnswers = (cloze.back || []).map((a: string) => a.toLowerCase());
                const isCorrect = correctAnswers.includes(userAnswer);

                if (isCorrect) {
                    onComplete(true, userAnswer);
                } else {
                    BaseEngine.renderIncorrectScreen(
                        app,
                        filePath,
                        container,
                        cloze,
                        userAnswer,
                        (correct) => onComplete(correct, userAnswer)
                    );
                }
            }
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
            // For historical maps, featureId is the NAME. For present, try ADM0_A3/ISO_A3 first.
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
}
